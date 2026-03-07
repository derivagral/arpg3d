# Sim — Pity System

## What it solves
Tag drought: player goes 8 gates without seeing a crit affix → frustration.
Pity solves this by increasing the weight of under-offered tags quadratically.

## Data shape
```js
PityState = {
  droughts: { [tag: string]: number },  // missed gate count per tag
  totalGates: number,
}
```

## Lifecycle per gate

```
generateGate()
  └─► rollAffix (x N options) — each call uses getPityBoost(pity, tag)
  └─► tickDroughts(pity, offeredTags, ALL_TAGS)
        offered tags → drought = 0
        all other tags → drought += 1

player picks option
  └─► resolveGate()
        └─► resetDroughts(pity, pickedTags)  — chosen tags → drought = 0
```

## Boost formula
```
boost(drought) = 1 + (drought / 5)²
```

| Drought | Boost |
|---------|-------|
| 0       | 1.0×  |
| 5       | 2.0×  |
| 10      | 5.0×  |
| 15      | 10.0× |

The boost is applied per-tag and the maximum across an affix's tags wins.
An affix with tags `['crit', 'damage', 'precision']` gets the highest boost among those three.

## Tuning
- Raise the divisor (5) to make pity kick in later / more gently.
- Lower it for aggressive pity (drought=3 → 1.36×).
- The exponent (2) can be raised (cubic) for steeper late-drought boosts.
- These constants live in `getPityBoost()` in `sim/pity.js`.
