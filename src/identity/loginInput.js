/**
 * src/identity/loginInput.js — what a player is allowed to type into sign-in
 *
 * THE PROBLEM THIS EXISTS FOR: the Bluesky app signs you in with an EMAIL and
 * a password. atproto OAuth cannot. OAuth resolves an *identifier* — a handle,
 * a DID, or the URL of a server — to a PDS, and then hands the player to that
 * server to authenticate. An email address is none of those things: nothing in
 * the network maps `you@example.com` to an account, because that mapping only
 * exists inside your own PDS's private user table.
 *
 * So a player who types the thing that works in the app gets, from deep inside
 * the OAuth library, `Failed to resolve identity: you@example.com` — which is
 * true, useless, and echoes their email back onto the screen. Catching that
 * case up front and saying "we need your handle, here is where to find it" is
 * the entire point of this module.
 *
 * The three forms the OAuth resolver actually accepts (see
 * @atproto/oauth-client's OAuthResolver.resolve):
 *
 *   handle    alice.bsky.social       resolved via DNS/well-known → DID → PDS
 *   did       did:plc:abc123          resolved directly to a DID document
 *   service   https://bsky.social     used as a PDS/entryway URL as-is
 *
 * That last one is the escape hatch worth telling players about: someone who
 * does not remember their handle can type their server and sign in there.
 *
 * Pure module — no network, no globals, no storage. Validation here is
 * deliberately a little looser than the protocol's (it does not know which
 * TLDs are reserved, and does not do punycode), because its job is to catch
 * the mistakes a human makes at a text field, not to be the authority on
 * handle syntax. Anything it lets through is still checked for real by the
 * resolver.
 */

/** The shapes of input the atproto OAuth resolver understands. */
export const FORM_HANDLE = 'handle'
export const FORM_DID = 'did'
export const FORM_SERVICE = 'service'

/** The server most players are on, used in hints and as the escape hatch. */
export const DEFAULT_ENTRYWAY = 'https://bsky.social'

/** Shown under the sign-in field. Kept here so the copy sits with the rules. */
export const LOGIN_HINT =
  `Your handle, not your email — it's the @name you post under. ` +
  `No idea? Type your server instead (${DEFAULT_ENTRYWAY}).`

/**
 * A rejection a player can act on.
 *
 * `code` is for the debug trace and for tests; `message` is what the player
 * reads and must stand on its own. Nothing here ever includes the raw input,
 * so an email typed by mistake is not echoed back to the screen or recorded.
 */
export class LoginInputError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'LoginInputError'
    this.code = code
  }
}

/**
 * Normalize and classify what the player typed.
 *
 * @param {string} raw
 * @returns {{ value: string, form: 'handle'|'did'|'service' }}
 * @throws {LoginInputError} with a message written for the player
 */
export const normalizeLoginInput = (raw) => {
  const trimmed = String(raw ?? '').trim()
  if (trimmed === '') {
    throw new LoginInputError(
      `Enter your handle to sign in — it looks like alice.bsky.social.`,
      'empty',
    )
  }

  // A leading '@' is how handles are written everywhere else, so accept it.
  const input = trimmed.replace(/^@/, '')

  // Server URL: passed through to the resolver as a PDS/entryway address.
  if (/^https?:\/\//i.test(input)) return { value: normalizeServiceUrl(input), form: FORM_SERVICE }

  // DID: case-sensitive after the method, so this one is NOT lowercased.
  if (/^did:/i.test(input)) return { value: input, form: FORM_DID }

  // The case this module exists for. Checked before generic character rules
  // so that an email gets the email answer rather than "bad characters".
  if (input.includes('@')) {
    throw new LoginInputError(
      `That looks like an email address. Signing in here needs your handle — ` +
      `the @name you post under, like alice.bsky.social. It's in the Bluesky ` +
      `app under Settings → Account → Handle. If you'd rather not look it up, ` +
      `type ${DEFAULT_ENTRYWAY} instead and sign in there.`,
      'email',
    )
  }

  return { value: normalizeHandle(input), form: FORM_HANDLE }
}

/**
 * A server URL, reduced to origin + path with no trailing slash. Rejects
 * anything that is not a parseable absolute http(s) URL.
 * @returns {string}
 */
const normalizeServiceUrl = (input) => {
  let url
  try {
    url = new URL(input)
  } catch (_) {
    throw new LoginInputError(
      `That doesn't look like a server address. Try ${DEFAULT_ENTRYWAY}.`,
      'bad-url',
    )
  }
  if (url.username || url.password) {
    throw new LoginInputError(
      `Leave the username out of the server address — just ${DEFAULT_ENTRYWAY}.`,
      'url-credentials',
    )
  }
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host}${path}`
}

/**
 * Validate a handle well enough to catch typing mistakes, and lowercase it
 * (handles are case-insensitive and compared lower-cased).
 * @returns {string}
 */
const normalizeHandle = (input) => {
  const handle = input.toLowerCase().replace(/\.+$/, '')

  if (!/^[a-z0-9.-]+$/.test(handle)) {
    throw new LoginInputError(
      `Handles are just letters, numbers, dots and dashes — like alice.bsky.social.`,
      'bad-characters',
    )
  }
  if (handle.length > 253) {
    throw new LoginInputError(`That handle is too long to be real.`, 'too-long')
  }

  const labels = handle.split('.')
  if (labels.length < 2) {
    // By far the most common near-miss: the app shows "@alice" in some places
    // and the player types only that.
    throw new LoginInputError(
      `Handles include the server too. Try ${handle}.bsky.social rather than ${handle}.`,
      'no-domain',
    )
  }
  for (const label of labels) {
    if (label === '') {
      throw new LoginInputError(`There's an extra dot in there.`, 'empty-label')
    }
    if (label.length > 63) {
      throw new LoginInputError(`Part of that handle is too long to be real.`, 'label-too-long')
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      throw new LoginInputError(
        `Handles can't start or end a part with a dash.`,
        'label-hyphen',
      )
    }
  }
  if (/^[0-9]/.test(labels[labels.length - 1])) {
    throw new LoginInputError(
      `That doesn't look like a handle — the last part should be a domain, like bsky.social.`,
      'numeric-tld',
    )
  }

  return handle
}

/**
 * A version of the input that is safe to write into the debug trace, which is
 * persisted and may be pasted into a bug report.
 *
 * Handles, DIDs and server URLs are public identifiers and are recorded as-is
 * — being able to see the exact string is most of the value of a trace. An
 * email is not, so it is masked to just enough to recognise the typo.
 * @returns {string}
 */
export const redactLoginInput = (raw) => {
  // Leading '@' is handle notation, not an email, so it is stripped before
  // the test rather than counted as one.
  const input = String(raw ?? '').trim().replace(/^@/, '')
  if (input === '') return '(empty)'
  if (!input.includes('@') || /^https?:\/\//i.test(input)) return input

  const at = input.lastIndexOf('@')
  const local = input.slice(0, at)
  const domain = input.slice(at + 1)
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`
}
