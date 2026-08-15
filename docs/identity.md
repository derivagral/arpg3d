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
   `.github/workflows/deploy.yml` derives them from the repository (handling
   the `<owner>.github.io` user-site case) and then **asserts** that the built
   `client_id` equals the document's own URL and that the callback file exists,
   failing the deploy rather than publishing a site whose sign-in is quietly
   broken. Using a custom domain means editing `SITE_ORIGIN` in that workflow
   and setting the base to `/`.

   Deploying requires one manual step that cannot be done from code: repo
   **Settings → Pages → Source → "GitHub Actions"**.

3. **Local dev must be browsed at `127.0.0.1`, not `localhost`.** The loopback
   `client_id` form uses the literal host `localhost`, but the redirect URI must
   be `127.0.0.1` or `[::1]`. Browsing at `localhost:5173` completes the
   redirect on a *different origin*, where the IndexedDB session is not visible,
   and sign-in silently appears to do nothing. `vite.config.js` binds the dev
   server to `127.0.0.1` for exactly this reason.

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

**ARPG3D still uses the synchronous `saves` store**, not the async
`host.storage` adapter — it predates this contract. The shell namespaces that
store by subject, so the identity model holds, but the game could not yet be
moved into a Worker. Porting it is the remaining work; **new games should use
`host.storage` from the start.**
