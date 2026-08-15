/**
 * src/games/arpg3d/save.js — ARPG3D's save codec
 *
 * Two halves, joined here:
 *   - the generic envelope (src/storage/saveFormat.js): magic tag, schema
 *     version, migrations, compatibility verdict, portable export codes
 *   - ARPG3D's spec (sim/save.js): what a body is, how a SimState serializes,
 *     and which migrations exist
 *
 * The split exists so a second game gets all of the first half for free
 * without importing anything out of `sim/`, which is ARPG3D's own logic.
 *
 * On-disk compatibility is exact: same `arpg3d` tag, same schema version, same
 * `arpg3d.v2.<base64url>` export codes, same storage keys. Saves written
 * before this refactor load unchanged, which is the whole requirement.
 */

import { createSaveFormat } from '../../storage/saveFormat.js'
import { ARPG3D_SAVE_SPEC } from '../../../sim/save.js'

export const arpg3dSaveFormat = createSaveFormat(ARPG3D_SAVE_SPEC)

// Named re-exports so callers read the same as they did when this machinery
// lived in sim/save.js.
export const {
  gameId: GAME_ID,
  schemaVersion: SAVE_SCHEMA_VERSION,
  newSaveId,
  createSaveFile,
  updateSaveFile,
  validateSaveFile,
  migrateSaveFile,
  checkCompatibility,
  encodeSaveCode,
  decodeSaveCode,
  parseImportText,
} = arpg3dSaveFormat

export default arpg3dSaveFormat
