# Sim — Movement & Position

## Why position lives in the sim
Everything gameplay-relevant must be deterministic and headless-simulatable:
offline idle progress replays real ticks, and where the player stood is part
of a run's outcome. If movement lived in the render layer, offline progress
could not be simulated faithfully and replays would diverge. The render layer
draws `player.x` / `player.z`; it never owns them.

## Arena
Combat happens in a disc of `ARENA_RADIUS` (23) centred on the origin.
Bounds are what make kiting a skill rather than an exploit — you cannot
outrun a swarm forever. `clampToArena(x, z)` is the single funnel for player
position, so no policy can escape.

The player is recentred to the origin at each wave start, so the spawn ring
is always drawn around them and every wave begins as a clean engagement.

## Who owns the player you can see
The rendered player **is** the sim player wherever a run is ticking. That was
not always true, and the gap mattered more than it sounds: `syncSimToRender()`
used to be an empty stub, so policies steered an invisible sim player while the
character on screen was the legacy WASD one. The ladder decided a run's depth,
echoes and loot, and had no expression on screen at all — the measured spread
below was real but unwatchable.

Position is therefore the first system to genuinely cross the sim/render line:

| Where | Owns position | How |
|-------|---------------|-----|
| Combat zone | the sim | `syncSimToRender()` → `player.driveTo(x, z)` each tick |
| Home base | the keyboard | `Player.applyKeyboardMovement()` — no run is ticking |

`Player.positionDriven` is the latch, and `game.onAreaChanged` releases it on
the way home. Exactly one writer at a time is the whole point: with both live,
the sim's write lands last every frame and WASD reads as dead input.

The two layers share **one scale** — a sim unit is a world unit, with no
conversion anywhere. Introducing one would make `ARENA_RADIUS` and the render
layer's `groundSize` mean two different distances.

### Screen convention
The camera sits at `-z` looking toward `+z`, so **W is `+z`** ("up the
screen"). The sim's key mapping (`MOVE_KEYS` in `src/games/arpg3d/index.js`)
had this inverted, which was harmless for exactly as long as the sim player
was never drawn — the moment the mesh followed sim position, W walked the
character toward the camera in combat and away from it at home base. Both
layers now state the same convention.

### Two visible artifacts, both deliberate
- **Waves recentre you.** The sim resets the player to the origin at each wave
  start, which renders as a teleport rather than a walk. `driveTo()` skips its
  facing update for steps larger than `Player.MAX_DRIVEN_STEP` so the model
  doesn't snap to a heading it never walked.
- **The arena is smaller than the ground.** `ARENA_RADIUS` (23) confines the
  sim player well inside the combat zone's 69-wide ground, so you cannot walk
  to the visible edge. The disc is the real play space; the ground is scenery.

## Movement as a policy
Movement is a pure function from (player, enemies) to a direction:

```js
(player, enemies) => [dirX, dirZ, nextWaypoint]   // dir is a unit vector
```

Manual play is **not a separate code path** — it is an input that overrides
the policy:

```js
input.move       = { x, z }   // manual control (any magnitude, normalized)
input.movePolicy = 'hold' | 'center' | 'patrol' | 'kite'
```

Same tick, same balance model, still deterministic (record the input stream →
replay the run). That is what keeps "fall back to regular ARPG controls for
encounters" free rather than a second implementation.

## The policy ladder
Policies are deliberately ordered from dumb to smart, because better movement
AI is intended to be an *unlock* — buying intelligence for your idle worker
(see docs/design/rewards-and-loops.md). `DEFAULT_POLICY` is `center`, not the
strongest option, to leave that progression headroom.

| Policy   | Behaviour                                              |
|----------|--------------------------------------------------------|
| `hold`   | Stand and fight. Maximum damage taken — the floor.     |
| `center` | Walk back to the middle and hold. Default.            |
| `patrol` | Circuit four cardinal waypoints, dragging the swarm; hunts the nearest enemy once nothing is within `PATROL_ENGAGE_RADIUS`. |
| `kite`   | Flee the local threat centroid with a tangential bias so the escape path curves instead of pinning you to the wall. |

Measured spread (autopilot gate picks, 7 seeds, death depth):

| Policy   | Death depth |
|----------|-------------|
| `hold`   | 4           |
| `center` | 4           |
| `patrol` | 18–24       |
| `kite`   | 23–24+      |

That ~5x gap is the point: movement is the single largest lever on run
outcome, which is what makes an unlockable movement ladder worth having.
(Figures are with no meta upgrades; a bought-out board pushes kite to ~50.)
Policies are earned through achievements — see docs/sim/profile.md — and the
engine clamps `input.movePolicy` to what the run actually unlocked.

## Choosing a policy
The choice is a **standing order**, not part of the run snapshot. Gear is
frozen at run start; a policy is not, because changing your idle worker's
orders while it works is the point of having orders.

Three pieces, in the sim so a UI can't invent its own rules:

| Piece | What it does |
|-------|--------------|
| `profile.movePolicy` | the stored preference, so a choice survives a reload |
| `setMovePolicy(profile, name)` | pure setter; refuses unknown/locked names **with a reason** |
| `activePolicy(profile)` | normalizes on read — a retired or un-unlocked policy reads as the default rather than silently falling through |
| `POLICY_META` | id/name/description per policy, for rendering the ladder |

`POLICY_META` lives beside the implementations in `sim/movement.js`, and
`sim/movement.test.js` asserts the two lists match: a policy missing from it is
one the player can never choose, and an entry without an implementation is an
option that does nothing when picked.

`game.movement` (`src/games/arpg3d/index.js`) is the single validated seam over
all of this — `current()`, `list()`, `set()` — installed on the game instance
the same way `openStashPanel` is. The dev console goes through it today and a
selector UI would go through the same three calls; there is deliberately no
bare setter, because the engine's own clamp is silent by design and a UI that
appeared to select a locked policy would be lying.

There is **no in-game selector yet** — `window.__setMovePolicy()` is still the
only way to change it. That is a missing view over a finished mechanism, not a
missing mechanism.

## Runs must never stall
A moving player is strictly faster than `basic` (0.06) and `tank` (0.035), so
a policy that *always* travels can never be caught by the stragglers it needs
to kill: the wave never clears, the run never ends, and the whole meta loop
freezes. Widening the arena from 20 to 23 triggered exactly this — `patrol`
sat at depth 5 for 16 simulated minutes.

`patrol` therefore circles only while something is within
`PATROL_ENGAGE_RADIUS` (8); once it has outrun everything it turns and closes
on the nearest enemy. Circling is what strings enemies out (fewer in melee at
once, which is why patrol beats `hold`), and hunting is what guarantees the
wave ends.

Two failed attempts are worth recording: a hunt-when-few-remain threshold
still stalled (it just stalled later, with 5+ tanks trailing), and
"stand still whenever anything is in range" collapsed patrol into `hold`
(depth 4) because the pile catches up the moment you stop.

`sim/movement.test.js` asserts every policy either dies or keeps progressing.

## Balance premise: speed is a tradeoff, not immunity
Enemy speeds are balanced against `BASE_PLAYER.speed` (0.15):

- `fast` (0.17) **outruns** the player — it must be killed, never escaped
- `swarm` (0.13) nearly keeps pace and overwhelms by number
- `basic` (0.06) and `tank` (0.035) are kiteable

If every enemy were slower than the player, *any* movement policy would be
unkillable in an open arena — an early version of this had exactly that bug
(`patrol` ran indefinitely). `sim/movement.test.js` guards the invariant.

## Engagement slots
`ENGAGEMENT_SLOTS` (5, in `sim/engine.js`) caps how many enemies can melee
simultaneously — a surround limit. Without it, incoming dps scales with wave
size, since every enemy converges on one point and swings at once. Overflow
enemies crowd but cannot attack. The legacy render layer mirrors this via
`CONFIG.combat.engagementSlots`.

## Determinism note
`norm()` adds `+ 0` to its results to normalize `-0` to `+0`. A `-0` reaching
player position compares equal in memory but serializes to `0`, which would
break save round-trip equality.

## Adding a policy
1. Add it to `MOVE_POLICIES` in `sim/movement.js` (pure, no RNG unless
   threaded explicitly).
2. Add a case to `sim/movement.test.js` — at minimum, that it returns a unit
   vector and respects arena bounds.
3. If it should be gated, register it with the unlock system rather than
   changing `DEFAULT_POLICY`.
