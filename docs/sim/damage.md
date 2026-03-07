# Sim — Damage Pipeline

## Formula (PoE-standard)

```
final = (base + flat) × (1 + Σincreased/100) × Π(1 + more_i/100) × critMult?
```

**Step 1 — Flat addition**
All flat damage bonuses sum directly into the base. Flat is strongest at low base values.

**Step 2 — Increased (additive pool)**
All `% increased` bonuses from affixes sum together, then apply as one multiplier.
Ten affixes of +20% increased = one ×3.0 multiplier. Diminishing returns in aggregate.

**Step 3 — More (multiplicative)**
Each `% more` bonus is its own multiplier. 20% more + 30% more = ×1.2 × ×1.3 = ×1.56.
No diminishing returns — each "more" is fully independent.

**Step 4 — Crit**
Roll RNG. If roll < critChance → multiply by critMult (default 1.5×, stackable).

## API
```js
import { calcDamage, aggregateDamageModifiers } from './sim/damage.js'

const mods = aggregateDamageModifiers(player.affixes)
// mods: { flat, increased, more[], critChance, critMult }

const [damage, nextRng, wasCrit] = calcDamage({
  base: 10,
  ...mods,
  rngState: currentRng
})
```

## Design notes
- `calcDamage` is a pure function — same inputs = same output (except crit uses RNG).
- Crit must always consume an RNG step to preserve determinism (even if critChance=0, no, actually it does check. If critChance=0, roll < 0 is always false — one RNG step is still consumed for determinism).
- `more` is an array because future skills may add/remove individual "more" sources.
- Result is `Math.round()` — always an integer for clean UI display.
