# Save System

Local-first state storage: save slots persist in `localStorage`, with third-party
export as raw JSON or a portable single-line code. No accounts, no server — a
login flow can layer on later without changing the format.

## Layers

```
sim/save.js              FORMAT (pure, Node-importable, tested)
  serializeSim/hydrateSim     SimState ↔ plain snapshot
  createSaveFile/updateSaveFile  versioned envelope around a snapshot
  validateSaveFile/checkCompatibility/migrateSaveFile  schema gatekeeping
  encodeSaveCode/decodeSaveCode/parseImportText  portable export codes

src/storage/saveStore.js STORAGE (localStorage CRUD, injectable backend)
  list/get/create/update/rename/remove
  importSaveFile/exportJson/exportCode

src/ui/mainMenu.js       UI (pre-Babylon DOM overlay)
  slot list, New Run (name + optional seed), Play/Rename/Delete,
  Export (JSON download / copy code), Import (paste or .json file)

src/main.js              WIRING
  menu gates the boot — Babylon engine + Game are not created until a
  slot is chosen; autosaves on wave clear, death, and pagehide
```

## Save file format (schema v1)

```jsonc
{
  "game": "arpg3d",          // magic — rejects foreign JSON on import
  "v": 1,                    // SAVE_SCHEMA_VERSION at write time
  "id": "sv_x7k2...",        // slot id (regenerated on import, never clobbers)
  "name": "Run 6/11 1:17 PM",
  "createdAt": 1780000000000,
  "updatedAt": 1780000012345,
  "meta": {                  // denormalized for the slot list — no hydration needed
    "depth": 2, "phase": "combat", "hp": 100, "maxHp": 100,
    "gold": 0, "xp": 12, "affixCount": 1, "elapsed": 12876
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

## Versioning & migration

- `SAVE_SCHEMA_VERSION` in `sim/save.js` — bump on breaking format changes.
- `MIGRATIONS` maps version N → a function upgrading a save to N+1;
  `checkCompatibility` runs the chain automatically.
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

Single localStorage key `arpg3d:saves:v1` holding `{ v, saves: { [id]: SaveFile } }`.
Saves are ~1-5 KB each; atomic read-modify-write of one blob beats per-slot keys
at this size. A corrupt envelope is backed up to `arpg3d:saves:v1:corrupt-backup`
rather than destroyed, and the store starts empty.

The backend is injectable (`createSaveStore(storage)`) — tests run against a
Map; a future remote backend implements the same three-method surface.

## Autosave cadence

`src/main.js` persists the active slot when the sim phase transitions to
`gate` (wave cleared) or `dead`, and on `pagehide`. Worst case on a crash:
the current wave's progress.

## Dev console

```js
window.__save()    // force-save the active slot, returns the stored file
window.__store     // the save store (list/get/remove/exportCode/...)
```

## Testing

- `sim/save.test.js` — round-trip identity, post-hydration tick determinism,
  mid-gate saves, unknown-affix tolerance, version rejection, code encode/decode.
- `src/storage/saveStore.test.js` — CRUD, list ordering, import collision
  handling, corrupt-envelope backup, export round-trips.
