/**
 * sim/movement.js — Player position, arena bounds, and movement policies
 *
 * Position lives in the sim (not the render layer) because everything
 * gameplay-relevant must be deterministic and headless-simulatable: offline
 * idle progress replays real ticks, and a run's movement is part of its
 * outcome. The render layer draws player.x/z; it never owns them.
 *
 * Movement is expressed as a *policy* — a pure function from (player,
 * enemies) to a direction. Manual play is not a separate code path: it's
 * just an input that overrides the policy, so ARPG controls and idle
 * automation share one tick and one balance model.
 *
 *   input.move        = { x, z }   → manual control (any magnitude, normalized)
 *   input.movePolicy  = 'hold' | 'center' | 'patrol' | 'kite'
 *
 * Policies are deliberately a ladder from dumb to smart. Better movement AI
 * is meant to be an unlock (see docs/design/rewards-and-loops.md — buying
 * intelligence for your idle worker), which is why 'center' is the default
 * rather than the strongest option.
 */

/** Combat arena is a disc centred on the origin. Bounds make kiting a skill
 *  rather than an exploit — you cannot outrun a swarm forever.
 *  Mirrored by CONFIG/areaManager groundSize in the render layer. Widening
 *  this makes kiting stronger, so re-run the policy sweep after changing it
 *  (docs/sim/movement.md). */
export const ARENA_RADIUS = 23

const PATROL_RADIUS = ARENA_RADIUS * 0.6

/** Patrol circuit: four cardinal waypoints. */
export const PATROL_POINTS = [
  { x:  PATROL_RADIUS, z: 0 },
  { x: 0, z:  PATROL_RADIUS },
  { x: -PATROL_RADIUS, z: 0 },
  { x: 0, z: -PATROL_RADIUS },
]

const WAYPOINT_REACHED = 1.5
const THREAT_RADIUS = 6
/** Patrol hunts once nothing is within this radius — see the policy comment. */
const PATROL_ENGAGE_RADIUS = 8
const RECENTER_DEADZONE = 0.5

/** Policy used when none is specified — naive "hold the middle". */
export const DEFAULT_POLICY = 'center'

// `+ 0` normalizes -0 to +0. A -0 reaching player position would compare
// equal in memory but serialize to 0, breaking save round-trip determinism.
const norm = (x, z) => {
  const m = Math.sqrt(x * x + z * z)
  return m < 1e-9 ? [0, 0] : [x / m + 0, z / m + 0]
}

/** Clamp a position inside the arena disc. */
export const clampToArena = (x, z, radius = ARENA_RADIUS) => {
  const d = Math.sqrt(x * x + z * z)
  if (d <= radius) return [x, z]
  return [(x / d) * radius, (z / d) * radius]
}

/**
 * Movement policies. Each is pure:
 *   (player, enemies) => [dirX, dirZ, nextWaypoint]
 * Direction is a unit vector (or zero to stand still).
 */
export const MOVE_POLICIES = {
  // Stand and fight. Maximum damage taken — the floor of the ladder.
  hold: (player) => [0, 0, player.waypoint],

  // Return to the middle and hold. Naive but keeps you off the arena wall.
  center: (player) => {
    if (Math.sqrt(player.x * player.x + player.z * player.z) < RECENTER_DEADZONE) {
      return [0, 0, player.waypoint]
    }
    const [x, z] = norm(-player.x, -player.z)
    return [x, z, player.waypoint]
  },

  // Circuit four fixed waypoints, dragging the swarm behind you. The circuit
  // is what makes patrol good: enemies string out along the path instead of
  // arriving as one pile, so fewer of them are ever in melee at once.
  //
  // The catch is stragglers. A moving player is strictly faster than 'basic'
  // and 'tank', so a continuous circuit can NEVER be caught by them — the last
  // few enemies are chased forever, the wave never clears, and the run stalls
  // (observed: depth 5 held for 16 minutes once the arena was widened). So
  // once the wave is nearly done, patrol closes on the nearest enemy instead
  // of circling past it. Hunting only when few remain keeps the stringing-out
  // behaviour for the part of the wave where it matters.
  patrol: (player, enemies = []) => {
    // Engaged → keep circling (that's what strings them out).
    // Disengaged → you have outrun the pack; go and find it.
    let nearest = null, nearestD = Infinity
    for (const e of enemies) {
      const d = Math.hypot(player.x - e.x, player.z - e.z)
      if (d < nearestD) { nearestD = d; nearest = e }
    }
    if (nearest && nearestD > PATROL_ENGAGE_RADIUS) {
      const [x, z] = norm(nearest.x - player.x, nearest.z - player.z)
      return [x, z, player.waypoint]
    }

    const wp = PATROL_POINTS[player.waypoint % PATROL_POINTS.length]
    const dx = wp.x - player.x
    const dz = wp.z - player.z
    if (Math.sqrt(dx * dx + dz * dz) < WAYPOINT_REACHED) {
      return [0, 0, (player.waypoint + 1) % PATROL_POINTS.length]
    }
    const [x, z] = norm(dx, dz)
    return [x, z, player.waypoint]
  },

  // Flee the local threat centroid, with a tangential bias so the escape
  // path curves around the arena instead of pinning you against the wall.
  kite: (player, enemies = []) => {
    let ax = 0, az = 0, threats = 0
    for (const e of enemies) {
      const dx = player.x - e.x
      const dz = player.z - e.z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < THREAT_RADIUS) {
        const w = 1 / Math.max(0.5, d)   // nearer enemies push harder
        ax += (dx / d) * w
        az += (dz / d) * w
        threats++
      }
    }
    if (threats === 0) return MOVE_POLICIES.center(player, enemies)

    const [fx, fz] = norm(ax, az)
    const [ox, oz] = norm(player.x, player.z)
    const [x, z] = norm(fx - oz * 0.7, fz + ox * 0.7)  // + tangential drift
    return [x, z, player.waypoint]
  },
}

/**
 * Resolve this frame's movement direction.
 * Manual input wins over any policy — that's the ARPG-controls fallback.
 *
 * @param {object} player - sim player (x, z, waypoint)
 * @param {object[]} enemies
 * @param {{ move?: {x:number, z:number}, movePolicy?: string }} input
 * @returns {[number, number, number]} [dirX, dirZ, nextWaypoint]
 */
export const resolveMove = (player, enemies, input = {}) => {
  if (input.move) {
    const [x, z] = norm(input.move.x || 0, input.move.z || 0)
    return [x, z, player.waypoint]
  }
  const policy = MOVE_POLICIES[input.movePolicy] ?? MOVE_POLICIES[DEFAULT_POLICY]
  return policy(player, enemies)
}
