# Save System

Local-first state storage, keyed to the player's identity subject, with
third-party export as raw JSON or a portable single-line code. Saves live on an
injectable async backend, so moving them to IndexedDB or a server is a backend
swap rather than a rewrite. See `docs/identity.md` for who a player is and why
saves are keyed on a DID rather than a handle.

## Layers

```
src/storage/saveFormat.js  ENVELOPE (generic, reusable by any game)
  createSaveFormat(spec)      binds the machinery below to one game
  createSaveFile/updateSaveFile  versioned envelope around a body
  validateSaveFile/checkCompatibility/migrateSaveFile  schema gatekeeping
  encodeSaveCode/decodeSaveCode/parseImportText  portable export codes

sim/save.js              ARPG3D's BODY (pure, Node-importable, tested)
  serializeSim/hydrateSim     SimState ↔ plain snapshot
  buildMeta                   denormalized summary for slot lists
  MIGRATIONS                  step migrations, keyed by version-from
  ARPG3D_SAVE_SPEC            what createSaveFormat() needs

src/games/arpg3d/save.js COMPOSITION
  arpg3dSaveFormat = createSaveFormat(ARPG3D_SAVE_SPEC)

src/storage/saveStore.js STORAGE (slot CRUD, async, serialized)
  list/get/create/update/rename/remove
  importSaveFile/exportJson/exportCode
  updateSync — synchronous unload flush, where the backend supports it

src/storage/backends/    BYTES (async read/write/remove)
  localStorage.js  default; can flush synchronously on pagehide, ~5MB cap
  indexedDb.js     far larger, never blocks the main thread, NO unload flush

src/ui/mainMenu.js       UI (pre-Babylon DOM overlay)
  slot list, New Run (name + optional seed), Play/Rename/Delete,
  Export (JSON download / copy code), Import (paste or .json file)

src/main.js              WIRING
  menu gates the boot — Babylon engine + Game are not created until a
  slot is chosen; autosaves on wave clear, death, and pagehide
```

## Save file format (schema v2)

```jsonc
{
  "game": "arpg3d",          // magic — rejects foreign JSON on import
  "v": 2,                    // SAVE_SCHEMA_VERSION at write time
  "id": "sv_x7k2...",        // slot id (regenerated on import, never clobbers)
  "name": "Run 6/11 1:17 PM",
  "createdAt": 1780000000000,
  "updatedAt": 1780000012345,
  "meta": {                  // denormalized for the slot list — no hydration needed
    "depth": 2, "phase": "combat", "hp": 100, "maxHp": 100,
    "gold": 0, "xp": 12, "affixCount": 1, "elapsed": 12876,
    "echoes": 140, "bestDepth": 9, "runs": 4
  },
  "profile": {               // persistent character meta — survives death
    "v": 1, "echoes": 140, "spent": 60, "bestDepth": 9, "runs": 4,
    "lifetime": { "kills": { "basic": 210 }, "gold": 900, "depth": 31, "elapsed": 402000 },
    "upgrades": { "vitality": 2 },
    "unlocks": ["policy:patrol"],
    "achievements": ["depth_4"],
    "stash": [ /* 240 slots of item|null — survives death */ ],
    "equipment": { "weapon": { "uid": 12, "kind": "weapon", "rarity": "rare",
                               "ilvl": 9, "affixes": [{ "id": "flat_dmg_2",
                               "delta": { "flatDamage": 5 } }] }, "head": null }
  },
  "sim": {                   // full SimState snapshot, minus the log
    "seed": 4242, "rng": 123456789, "tick": 82, "elapsed": 12876,
    "phase": "combat", "depth": 2,
    "player": {
      "hp": 100, "maxHp": 100, "gold": 0, "xp": 12, "lastAttackTick": 76,
      "affixes": [{ "id": "inc_dmg_1", "delta": { "increased": 8 }, "weight": 8 }]
    },
    "enemies": [ /* plain EnemyData, exact positions/hp */ ],
    "gate": null,            // or { depth, options: [{ id, delta, weight }] }
    "pity": { "droughts": { "crit": 2 }, "totalGates": 1 }
  }
}
```

Design decisions:

- **Affixes are stored as `{id, delta, weight}`**, not full objects. Name, desc,
  tags, and category rehydrate from `AFFIX_POOL`, so balance renames propagate
  to old saves. The delta is stored verbatim because `rollAffix` can hand out
  wave-scaled deltas; the weight because rolled copies carry pity-boosted
  weights — restoring pool values would break exact round-trips.
- **Unknown affix ids never fail a load.** They hydrate as inert stubs (empty
  tags, zero value) and surface as console warnings — a save survives the
  affix being removed from the pool.
- **The event log is dropped on save.** It grows unboundedly; a resumed run
  starts a fresh log with a `run_resumed` entry.
- **Dead runs restart.** `tick()` is a no-op in phase `dead`, so Play on a dead
  slot starts a fresh run (new seed) in the same slot. The menu labels these.
  The restart takes a **new `runMeta` snapshot**, so upgrades bought since the
  last run apply.
- **A slot is a character.** The envelope carries a persistent `profile`
  (echoes, upgrades, unlocks) alongside the current run, and the run snapshot
  carries the `runMeta` it started with. Deleting a slot deletes its meta.
  See docs/sim/profile.md.

## Versioning & migration

- `SAVE_SCHEMA_VERSION` in `sim/save.js` — bump on breaking format changes.
- `MIGRATIONS` maps version N → a function upgrading a save to N+1;
  `checkCompatibility` runs the chain automatically.
- **v1 → v2** (slots became characters): a v1 save gains a fresh profile and a
  base-policy `runMeta`, loading as a brand-new character mid-run.
- Saves with a **newer** version (from a newer build) are rejected with a
  reason; saves with an **older** version and no migration path likewise.
  The menu lists incompatible slots grayed out — still exportable/deletable,
  not playable.

## Export formats

1. **JSON download** — pretty-printed save file, `<name>.arpg3d.json`.
2. **Portable code** — `arpg3d.v1.<base64url(json)>`, single line, clipboard-safe.

Import accepts either (paste box or file picker); `parseImportText` sniffs the
format. Imports always get a fresh slot id.

## Storage layout

One key per player: `arpg3d:saves:v1:<url-encoded subject>`, holding
`{ v, saves: { [id]: SaveFile } }`. Saves are ~1-5 KB each; read-modify-write of
one blob beats per-slot keys at this size — though per-slot keys are the change
to make before this goes over a network, since today every write ships every
slot. A corrupt envelope is backed up to `<key>:corrupt-backup` rather than
destroyed, and the store starts empty.

Saves written before identity existed are adopted once, into the guest's
namespace, by `adoptLegacySaves`. See `docs/identity.md` for that and for the
guest→account claim flow.

The backend is injectable (`createSaveStore({ backend, subject, format })`) and
every method is async. `localStorage` is the default; `indexedDb` lifts the 5MB
cap at the cost of the synchronous unload flush, and
`src/storage/chooseBackend.js` switches between them (copying, never moving).

Because writes are async, operations serialize on a per-store chain — the
envelope holds every slot, so an interleaved read-modify-write would lose a
whole save rather than a field.

## Reusing this for another game

`createSaveFormat(spec)` gives a new game the whole envelope — magic tag,
versioning, migrations, compatibility verdicts, export codes — without touching
`sim/`, which is ARPG3D's own logic. Supply `gameId`, `schemaVersion`,
`migrations`, `buildBody`, and optionally `validateBody`, then pass the result
to `createSaveStore({ format })`. The game id determines the keyspace, so two
games can never collide, and each rejects the other's files on import.

`src/games/arpg3d/save.test.js` pins this down from both directions: a real
export code produced by an older build still decodes, loads, and re-encodes
byte-for-byte identically, and a second format gets its own tag and keyspace.

## Autosave cadence

`src/main.js` persists the active slot when the sim phase transitions to
`gate` (wave cleared) or `dead`, and on `pagehide`. Worst case on a crash:
the current wave's progress.

## Dev console

```js
window.__save()    // force-save the active slot, returns the stored file
window.__store     // the save store (list/get/remove/getProfile/...)
window.__profile() // the active slot's character profile
```

## Testing

- `sim/save.test.js` — round-trip identity, post-hydration tick determinism,
  mid-gate saves, unknown-affix tolerance, version rejection, code encode/decode.
- `src/storage/saveStore.test.js` — CRUD, list ordering, import collision
  handling, corrupt-envelope backup, export round-trips.
