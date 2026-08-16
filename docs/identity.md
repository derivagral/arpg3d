# Identity & the game-host contract

How a player is identified, where their saves live, and what a game is allowed
to see.

The short version: **this is not service discovery, it is capability
injection.** The shell owns identity. Games are guests that receive an opaque,
already-resolved player context. Games never import the auth library, never see
a token, and never learn that atproto exists.

---

## The two facts everything else follows from

**1. The subject is the key. The handle is not.**

`did:plc:abc123` is permanent. `patrick.bsky.social` can be given up and handed
to someone else tomorrow. Every save file, score and settings blob is keyed on
the subject. The handle is display-only and refetched on load.

**2. Anonymous is a first-class identity, not a null.**

There is always a subject:

```js
{ subject: 'anon:0193-…uuid' | 'did:plc:abc123',
  kind:    'anon'            | 'atproto',
  display: { handle, name, avatar } | null }
```

A guest subject is a `crypto.randomUUID()` minted on first visit and kept in
localStorage. Because a guest has a real subject, no code below the shell ever
branches on logged-in-ness, and **nobody hits a login wall before they can
play.** Signing in is an upgrade, not an entry requirement.

---

## Layout

| Directory | Role |
|---|---|
| `src/identity/` | Identity value type, provider registry, the manager. No game or storage deps. |
| `src/host/` | The shell↔game boundary: capability object + adapters. |
| `src/games/` | Game modules. Each exports `manifest` + `mount`. |
| `src/ui/` | Shell chrome: identity chip, sign-in panel, pre-game menu. |
| `src/storage/` | Save slot CRUD, namespaced by subject. |
| `oauth/callback/` | The OAuth redirect landing page. A real file, not a route. |

These directory names mirror the packages this would split into
(`packages/identity`, `packages/game-host`, `games/*`) if the repo ever becomes
a monorepo. Nothing here depends on that happening.

---

## Adding an auth method

Write one object and register it in `src/identity/providers/index.js`. Nothing
else in the codebase changes — not the shell, not the menu, not the sign-in
panel, and certainly not any game.

```js
{
  id:    'passkey',              // stable key, persisted
  label: 'Sign in with a passkey',
  kind:  'passkey',              // lands in Identity.kind
  input: { name, label, placeholder } | undefined,   // one text field, if needed

  async available()          // can this run here at all?
  async restore()            // → Identity | null   (silent, no interaction)
  async signIn(input, { state })   // → Identity, OR navigates away
  async signOut(identity)
  async completeRedirect()   // → { identity, state }   redirect flows only
}
```

`signIn()` is allowed either to resolve with an Identity (in-page flows) or to
navigate away and never resolve (redirect flows). A provider that finishes
in-page simply never implements `completeRedirect()`.

The manager's guarantee: **`resolve()` always returns an Identity.** Expired
session, no network, blocked popup, storage disabled — every failure path falls
back to guest. No caller ever writes `if (identity)`.

---

## atproto specifics

Identity-only, public client, no backend. It runs on GitHub Pages as-is.

- **Scope is `atproto` and nothing else.** That is the identity-only scope: it
  yields the DID and no repo access, so there is no scary consent screen.
  Display name and avatar come from the public appview
  (`app.bsky.actor.getProfile`), unauthenticated.
- **`client_id` is a URL** — the address of `client-metadata.json`. There is no
  registration step; the authorization server fetches that document.
- **No password field, ever.** The player types a handle. We resolve handle →
  DID → PDS and redirect; they authenticate on their own server. This app never
  sees a credential.
- **A handle is not an email, and this is the #1 way sign-in "fails".** The
  Bluesky app signs you in with an email and a password; OAuth cannot. There is
  no public mapping from `you@example.com` to an account — that lookup only
  exists inside your own PDS's user table — so the resolver's honest answer to
  an email is `Failed to resolve identity: you@example.com`, which reads like a
  bug and is not one. `src/identity/loginInput.js` catches this before the
  OAuth library is even downloaded and answers with what to type instead.
  The resolver accepts three forms: a **handle** (`alice.bsky.social`), a
  **DID** (`did:plc:…`), or a **server URL** (`https://bsky.social`) — that
  last one being the escape hatch for someone who does not remember their
  handle, since they can then sign in at their server with the email and
  password they do remember.
- Sessions (DPoP keys included) live in IndexedDB and refresh themselves, so
  sign-in is persistent-until-revoked rather than ephemeral. "Forget me" is
  `manager.forgetGuest()` plus sign-out.

### Three things that are easy to get wrong

1. **The redirect URI needs a real file behind it.** GitHub Pages has no SPA
   rewrite, so a client-side route would 404 coming back from the PDS.
   `oauth/callback/index.html` is a real directory with a real file, registered
   as a second Vite entry point. The trailing slash is part of the registered
   value and must match byte-for-byte.

2. **`client_id` is origin+path-bound**, so the metadata is generated at build
   time from the deploy's base URL — production, a preview branch and localhost
   are three different clients. A GitHub Pages *project* site is served from a
   subpath and must build with:

   ```
   SITE_BASE=/arpg3d/ SITE_ORIGIN=https://<user>.github.io npm run build
   ```

   Both default to a root-served site.
   `.github/workflows/deploy.yml` takes them from `actions/configure-pages`,
   which reports where the site is actually served from — so a user site, a
   project site under `/<repo>/` and a custom domain all work with no edit to
   the workflow. It then **asserts** that the built `client_id` equals the
   document's own URL and that the callback file exists, failing the deploy
   rather than publishing a site whose sign-in is quietly broken.

   That same step also enables Pages and sets its source to GitHub Actions on
   the first run. Before it existed, a repo where that had never been set by
   hand built fine and then failed with `Failed to create deployment
   (status: 404)` from `deploy-pages` — the deployment endpoint does not exist
   until a Pages site does, and the 404 does not say so. The manual equivalent,
   if that step is ever refused, is **Settings → Pages → Source → "GitHub
   Actions"**.

3. **Local dev must be browsed at `127.0.0.1`, not `localhost`.** The loopback
   `client_id` form uses the literal host `localhost`, but the redirect URI must
   be `127.0.0.1` or `[::1]`. Browsing at `localhost:5173` completes the
   redirect on a *different origin*, where the IndexedDB session is not visible,
   and sign-in silently appears to do nothing. `vite.config.js` binds the dev
   server to `127.0.0.1` for exactly this reason.

### Debugging a sign-in

Sign-in spans four documents — the app, the player's PDS, `oauth/callback/`,
and the app again — so the devtools console is close to useless on this path:
each navigation clears it, and the failures that matter have their cause two
documents before their symptom. `src/identity/trace.js` records the flow into
a sessionStorage ring buffer instead, which is scoped to (origin, tab) and
survives leaving for the PDS and coming back. It is always on; it holds
identifiers only, never a token.

```js
__identity.report()      // the whole flow as pasteable text
__identity.trace()       // the same entries as objects
__identity.debug(true)   // also mirror to the console as it happens
__identity.clear()
```

`?identityDebug=1` on any page turns console mirroring on and remembers it, so
it is still in effect on the callback page. Failures are logged to the console
regardless. When the callback page itself fails, it shows the trace on screen
under "Details for a bug report".

What the trace is really there to catch — all of which look identical from the
outside ("sign-in just doesn't work") and are obvious the moment `client_id`,
`redirectUri` and `origin` can be read back:

| Entry | What it tells you |
|---|---|
| `atproto.client.load` | the `client_id`, `redirect_uri` and origin actually in use |
| `atproto.signIn.rejected` | input never left the browser (an email, a typo) |
| `manager.resolve.sessionGone` | there *was* a session and it did not restore |
| `manager.completeRedirect.noProvider` | the callback cannot see the storage the sign-in started in — the localhost/127.0.0.1 trap |

**Scope upgrades are not free.** If posting scores to a user's PDS ever becomes
interesting, widening the scope requires revoke + re-auth for every existing
user. Decide deliberately; do not drift into it.

---

## Saves are namespaced by subject

`arpg3d:saves:v1:<url-encoded subject>`. Consequences worth stating outright:

- Signing in does not "load your saves" — it **switches namespaces**.
- Two people sharing a browser get separate saves once signed in, and share the
  guest namespace when not. The guest subject identifies a *browser*, not a
  person.

**Adoption** (`adoptLegacySaves`): saves written before this system existed are
copied into the guest namespace once, so an existing player does not open the
menu to an empty list. A marker key stops a second subject from also claiming
them.

**The claim offer** (`src/storage/claim.js`): after a first sign-in, if the
guest namespace has saves, the player is offered a one-time copy across.

- It is a **copy, not a move.** The guest namespace is untouched, so signing out
  returns the player to exactly what they had. Nothing is ever destroyed.
- Copies get **fresh slot ids**, so a claim can never overwrite an existing save.
- The answer is remembered per *(guest → account)* pair, so declining is not
  nagged, and a second account on the same browser gets its own offer.

Signing out returns the player to the **same** guest subject, never a fresh one
— otherwise signing out would orphan every guest save.

---

## The game contract

Every game module exports exactly two things:

```js
// src/games/<id>/manifest.js
export const manifest = {
  id: 'arpg3d',
  title: 'ARPG3D',
  saveSchema: 2,
  capabilities: ['saves', 'telemetry', 'settings'],   // a request, not a grant
}

// src/games/<id>/index.js
export async function mount(container, host) {
  return { async unmount() {}, pause() {}, resume() {} }
}
```

The host is minted per launch and frozen:

```js
Object.freeze({
  player:    { subject, kind, display },   // snapshot, not live
  launch:    { … },                        // shell's per-launch choices
  storage:   { async get(slot), async put(slot, v), async list(), async remove(slot) },
  saves:     …,                            // versioned slot store, if granted
  telemetry: { async report(event, payload) },
  settings:  { async get() },
  async exit(reason),
})
```

**THE ONE RULE: no game module may import `@atproto/*` or reach for
`localStorage` directly.** If a game needs something, it goes through `host`.
That single rule is what keeps identity swappable and games sandboxable — a game
that reads localStorage has silently hardcoded "same origin, same thread, one
player" and cannot be moved into an iframe, a Worker, or onto a server without a
rewrite.

Three design points that look arbitrary and are not:

- **Everything is async**, even where today's implementation is synchronous. It
  costs nothing now and it means the whole host object can be swapped for a
  `postMessage` proxy or an HTTP adapter later with zero game-side changes.
  Making these synchronous would be a one-way door.
- **`player` is a frozen snapshot, not a subscription.** Identity changing
  mid-session is an *exit-to-shell* event. The shell unmounts and remounts
  rather than asking a game to answer "whose run is this?"
- **Undeclared capabilities are absent, not empty.** A game that forgets to
  declare `storage` fails loudly in development instead of silently working
  until the shell tightens up.

Adding a game is a **directory**, not a code change: `src/games/registry.js`
globs manifests eagerly (for the game-select screen) and imports the module
behind one lazily (so each game is its own chunk and players only download what
they launch).

---

## Pre-game flow

```
boot → resolve identity (silent restore, or mint guest)
     → title / save-slot menu       [identity chip visible throughout]
     → slot select
     → mount game                   [chip hidden — the game owns the screen]
```

The identity chip lives in the shell chrome across every pre-game screen:
*"Playing as guest · Sign in"* or *"@patrick.bsky.social · Sign out"*. Signing in
from the chip returns you to wherever you were — the return path is stashed
**before** the redirect starts, because a redirect provider never comes back to
finish the function that called it.

None of the shell's boot path waits on Babylon.js or the legacy `js/` globals,
so the menu works while the CDN script is still loading, or has failed. WebGL is
checked at mount, not at boot.

---

## Seams deliberately left open

**Storage adapter.** `local` now, `http` later, same interface.

**Server-side identity.** When a backend arrives, **do not send the DID as a
claim.** Either move to a backend-for-frontend (confidential client, session
cookie, longer-lived tokens the backend can invalidate), or stay a public client
and have the browser mint a service-auth JWT
(`com.atproto.server.getServiceAuth`, `aud` = your service DID) that the API
verifies against the user's signing key from their DID document. Either way
**the server derives the subject and never trusts it.** The `subject` field
travelling on telemetry records is for bucketing, not authentication.

**Trust boundary.** Client-reported scores are unverifiable — anything reported
through `host.telemetry` comes out of a JavaScript context the player fully
controls and can be fabricated with devtools open. That is fine as long as
nobody later mistakes it for fact. Score reporting goes through that one narrow
function precisely so that the day leaderboards become server-authoritative,
only the shell changes.

**Sandboxing.** Nothing isolates a game from the shell today. That is fine while
every game is first-party; it stops being fine the moment a game is
community-submitted, because same-origin code can read the identity layer's
IndexedDB — which holds the **DPoP private keys and OAuth session**, i.e.
enough to act as the player against their PDS. The host contract is shaped so
that an iframe or Worker can be slid underneath it (see below), but that work
has not been done and should be a hard prerequisite for third-party games.

---

## What the async storage API actually buys

Every storage method is async even where the current implementation is not.
That is cheap insurance, but it is worth being precise about what it insures
against, because the obvious answer is the least valuable one.

**The near-term payoff is not Workers.** It is:

- **An HTTP/server backend.** Inherently async. A synchronous API forecloses it
  without touching every call site.
- **IndexedDB.** `localStorage` is synchronous-only, caps around 5MB, and blocks
  the main thread on every write — and this game rewrites its whole envelope on
  each wave clear. IndexedDB is async-only, so a sync API rules it out.

Both are served by the backend split in `src/storage/backends/`: the save store
owns the format, the backend owns the bytes, and swapping one does not touch the
other.

**Workers are a real but narrower win.** The mechanical link is that
`localStorage` is a `Window`-only API — it does not exist inside a Worker at all
— so code that could ever run off the main thread cannot use it. For this game
specifically, Babylon needs the main thread for canvas and input, so "the game
in a Worker" realistically means *the sim in a Worker*, and the sim is currently
cheap. Two cases where it would genuinely pay off:

- **Offline catch-up.** This is an idle game; "you were away 8 hours" means
  simulating a very large number of ticks. On the main thread that is a frozen
  tab. The sim is already pure and deterministic, which is exactly the shape
  that ports cleanly.
- **Verifying a run** by re-simulating from seed plus an input log — same
  long-compute, must-not-freeze-the-UI story.

The `pagehide` path is the one place async persistence genuinely cannot work: a
promise may never resolve once the page is being torn down, so an async-only
save loses the last checkpoint on every tab close. Backends therefore advertise
an optional `canWriteSync`/`writeSync` capability, and callers **must**
feature-detect it — a future HTTP backend will not have it and has to fall back
to more frequent checkpoints.
