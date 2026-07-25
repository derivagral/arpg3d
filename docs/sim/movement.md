# Sim — Movement & Position

## Why position lives in the sim
Everything gameplay-relevant must be deterministic and headless-simulatable:
offline idle progress replays real ticks, and where the player stood is part
of a run's outcome. If movement lived in the render layer, offline progress
could not be simulated faithfully and replays would diverge. The render layer
draws `player.x` / `player.z`; it never owns them.

## Arena
Combat happens in a disc of `ARENA_RADIUS` (20) centred on the origin.
Bounds are what make kiting a skill rather than an exploit — you cannot
outrun a swarm forever. `clampToArena(x, z)` is the single funnel for player
position, so no policy can escape.

The player is recentred to the origin at each wave start, so the spawn ring
is always drawn around them and every wave begins as a clean engagement.

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
| `patrol` | Circuit four cardinal waypoints, dragging the swarm.  |
| `kite`   | Flee the local threat centroid with a tangential bias so the escape path curves instead of pinning you to the wall. |

Measured spread (autopilot gate picks, 7 seeds, death depth):

| Policy   | Death depth |
|----------|-------------|
| `hold`   | 4           |
| `center` | 4           |
| `patrol` | 17–23       |
| `kite`   | 22–24+      |

That ~5x gap is the point: movement is the single largest lever on run
outcome, which is what makes an unlockable movement ladder worth having.

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
