# Sim — Affixes

## Affix schema
```js
{
  id:       string,       // stable key — never rename (breaks saved runs)
  name:     string,       // display name
  desc:     string,       // one-liner for gate UI
  tags:     string[],     // pity tracks these; gate filters on these
  category: 'offense' | 'defense' | 'utility',
  weight:   number,       // base selection weight (before pity boost)
  value:    number,       // magnitude for autopilot scoring (bigger = autopilot prefers)
  delta: {                // stat changes applied when this affix is held
    flatDamage?:     number,   // added before increased multiplier
    increased?:      number,   // % increased (additive pool with others)
    more?:           number,   // % more (multiplicative — each "more" multiplies separately)
    critChance?:     number,   // probability 0–1
    critMult?:       number,   // added to base 1.5x crit multiplier
    maxHp?:          number,
    regen?:          number,   // HP per second
    lifeSteal?:      number,   // HP per kill
    attackRange?:    number,
    magnetRadius?:   number,
    xpMult?:         number,   // additive bonus (0.20 = +20% XP)
    speedMult?:      number,   // multiplicative speed scaling (1.15 = +15%)
    attackSpeedMult?: number,  // multiplied against base ms (0.85 = 15% faster)
  }
}
```

## Tag taxonomy (current)
| Tag           | Meaning                                        |
|---------------|------------------------------------------------|
| `damage`      | affects direct damage output                   |
| `flat`        | flat +damage (step 1 in pipeline)               |
| `increased`   | % increased damage (step 2)                    |
| `more`        | % more damage (step 3, multiplicative)         |
| `crit`        | critical strike system                         |
| `precision`   | accuracy / crit synergy                        |
| `melee`       | melee-specific (future: ranged tags)           |
| `attackSpeed` | attacks per second                              |
| `maxHp`       | life pool size                                 |
| `life`        | any life-related mechanic                      |
| `regen`       | health regeneration over time                  |
| `lifeSteal`   | life gained on kill/hit                        |
| `defense`     | general defensive benefit                      |
| `speed`       | movement speed                                 |
| `mobility`    | movement quality                               |
| `range`       | attack range                                   |
| `utility`     | general non-combat benefit                     |
| `magnet`      | pickup radius                                  |
| `xp`          | experience gain                                |
| `quality`     | comfort / QoL improvements                    |

## Adding a new affix
1. Add an entry to `AFFIX_POOL` in `sim/affixes.js` with a fresh unique `id`.
2. Ensure tags exist in the taxonomy above (add new tags to this table if needed).
3. `ALL_TAGS` is auto-derived from the pool — no manual update needed.
4. Test: `rollAffix(rng, createPity())` should be able to return the new affix.
5. Update `docs/AGENTS.md` if the affix introduces a new tag category.

## Pity interaction
`rollAffix` applies pity boost to each candidate affix's weight:
- boost = max boost across all of the affix's tags
- formula: `1 + (drought / 5)^2` per tag
- An affix with multiple high-drought tags gets a strong boost
