/**
 * src/identity/trace.js — a debug trace that survives the OAuth redirect
 *
 * Sign-in is not one page load, it is four:
 *
 *   1. the app          — the player types a handle and we start the flow
 *   2. their PDS        — a different origin entirely; we see nothing here
 *   3. oauth/callback/  — a fresh document; the token exchange happens here
 *   4. the app again    — reloaded, with the session restored from IndexedDB
 *
 * Console logging is therefore close to useless on this path: the devtools
 * console is cleared by each navigation unless "Preserve log" happens to be
 * ticked, so by the time something looks wrong the evidence for *why* is two
 * documents ago. Worse, the interesting failures (a client_id that doesn't
 * match the metadata document, a redirect_uri off by a trailing slash, an
 * origin that changed from 127.0.0.1 to localhost mid-flow) are precisely the
 * ones whose cause is on step 1 and whose symptom is on step 3.
 *
 * So the trace is a ring buffer in sessionStorage. sessionStorage is scoped to
 * (origin, tab) and outlives navigation within the tab — including leaving to
 * the PDS and coming back — which is exactly the lifetime of one sign-in
 * attempt. It is cheap enough to record unconditionally, so it is always on;
 * the debug FLAG only controls whether entries are also mirrored to the
 * console as they happen.
 *
 *   ?identityDebug=1              turn console mirroring on (sticky)
 *   ?identityDebug=0              turn it off
 *   __identity.trace()            read the whole flow back, any time
 *   __identity.report()           the same thing as pasteable text
 *
 * WHAT MUST NEVER GO IN HERE: tokens, DPoP keys, anything from the OAuth
 * session. This app never holds a credential in the first place (the player
 * authenticates on their own server), and the trace is written to disk and
 * meant to be pasted into a bug report, so callers pass identifiers — handles,
 * DIDs, client_ids, error names — and nothing else. `redactLoginInput` in
 * loginInput.js exists for the one field a player might type a secret-ish
 * thing into.
 */

export const TRACE_KEY = 'arpg3d.shell:identity:trace'
export const DEBUG_FLAG_KEY = 'arpg3d.shell:identity:debug'
export const DEBUG_PARAM = 'identityDebug'

/** Ring buffer size. One sign-in attempt is ~15 entries; this holds a few. */
export const TRACE_LIMIT = 60

/**
 * @param {{
 *   storage?: Storage,          // per-tab, survives navigation: sessionStorage
 *   flagStorage?: Storage,      // survives everything: localStorage
 *   sink?: Console,
 *   now?: () => number,
 *   location?: { pathname?: string, search?: string, origin?: string },
 *   limit?: number,
 * }} [opts]
 */
export const createIdentityTrace = ({
  storage = safeGlobal(() => globalThis.sessionStorage),
  flagStorage = safeGlobal(() => globalThis.localStorage),
  sink = globalThis.console,
  now = () => Date.now(),
  location = globalThis.location,
  limit = TRACE_LIMIT,
} = {}) => {
  const read = (store, key) => {
    try { return store?.getItem(key) ?? null } catch (_) { return null }
  }
  const write = (store, key, value) => {
    try {
      if (value === null) store?.removeItem(key)
      else store?.setItem(key, value)
    } catch (_) { /* storage disabled or full; tracing must never break login */ }
  }

  const loadEntries = () => {
    const raw = read(storage, TRACE_KEY)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch (_) {
      return []
    }
  }

  // Console mirroring is sticky so that ?identityDebug=1 typed once on the app
  // is still in effect two navigations later on the callback page.
  let mirroring = read(flagStorage, DEBUG_FLAG_KEY) === '1'
  const fromUrl = new URLSearchParams(location?.search ?? '').get(DEBUG_PARAM)
  if (fromUrl !== null) {
    mirroring = fromUrl !== '0' && fromUrl !== 'false'
    write(flagStorage, DEBUG_FLAG_KEY, mirroring ? '1' : null)
  }

  const append = (entry) => {
    const entries = loadEntries()
    entries.push(entry)
    write(storage, TRACE_KEY, JSON.stringify(entries.slice(-limit)))
    return entry
  }

  const api = {
    /**
     * Record a step. `data` must be plain, small and free of secrets.
     * @param {string} name dotted event name, e.g. 'atproto.signIn.start'
     * @param {object} [data]
     */
    event(name, data = {}) {
      const entry = {
        at: new Date(now()).toISOString(),
        page: location?.pathname ?? '?',
        name,
        ...data,
      }
      append(entry)
      if (mirroring) sink?.debug?.(`[identity] ${name}`, data)
      return entry
    },

    /**
     * Record a failure. Errors are ALWAYS mirrored to the console regardless
     * of the debug flag — a silent failure is the thing this file is for.
     * @param {string} name
     * @param {unknown} err
     * @param {object} [data]
     */
    error(name, err, data = {}) {
      const entry = append({
        at: new Date(now()).toISOString(),
        page: location?.pathname ?? '?',
        name,
        error: describeError(err),
        ...data,
      })
      sink?.warn?.(`[identity] ${name}:`, err, data)
      return entry
    },

    /** @returns {object[]} every entry still in the buffer, oldest first */
    entries: loadEntries,

    /** @returns {boolean} whether entries are mirrored to the console */
    mirroring: () => mirroring,

    /** @param {boolean} on */
    setMirroring(on) {
      mirroring = Boolean(on)
      write(flagStorage, DEBUG_FLAG_KEY, mirroring ? '1' : null)
      return mirroring
    },

    clear() {
      write(storage, TRACE_KEY, null)
    },

    /**
     * The trace as one pasteable block. Deliberately plain text: the point is
     * that a player can copy it out of the console into a bug report.
     * @returns {string}
     */
    report() {
      const entries = loadEntries()
      if (entries.length === 0) return 'identity trace: (empty)'
      return entries
        .map(({ at, page, name, error, ...rest }) => {
          const detail = Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(' ')
          // The cause gets its own line because it is usually the real answer
          // — the wrapper only says which step failed, not why.
          const failure = error
            ? `\n    !! ${error.name}: ${error.message}` +
              (error.cause ? `\n       caused by ${error.cause.name}: ${error.cause.message}` : '')
            : ''
          return `${at} ${page} ${name}${detail ? `  ${detail}` : ''}${failure}`
        })
        .join('\n')
    },

    /**
     * Hang the trace off a global so it can be reached from a devtools console
     * with no imports. Called once by the shell and once by the callback page.
     */
    install(target = globalThis) {
      if (!target) return api
      target.__identity = {
        trace: () => api.entries(),
        report: () => api.report(),
        clear: () => api.clear(),
        debug: (on = true) => api.setMirroring(on),
      }
      return api
    },
  }

  return api
}

/**
 * Errors reduced to something JSON-serializable. `cause` is followed one level
 * because the OAuth library wraps the interesting error inside a generic one —
 * `Failed to resolve identity: x` caused by the actual DNS/HTTP failure.
 * @returns {{ name: string, message: string, cause?: object }}
 */
export const describeError = (err) => {
  if (!err || typeof err !== 'object') return { name: 'Error', message: String(err) }
  const described = {
    name: err.name ?? 'Error',
    message: err.message ?? String(err),
  }
  if (err.cause) {
    const cause = err.cause
    described.cause = {
      name: cause?.name ?? 'Error',
      message: cause?.message ?? String(cause),
    }
  }
  return described
}

const safeGlobal = (get) => {
  try { return get() } catch (_) { return undefined }
}

/**
 * The trace every module in the identity stack writes to. A singleton because
 * the whole point is that the manager, the provider and the callback page all
 * append to ONE buffer; `createIdentityTrace` is exported for tests.
 */
export const identityTrace = createIdentityTrace()
