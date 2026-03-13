// Item affix pool — mirrors sim/affixes.js AFFIX_POOL data for the legacy layer.
// The sim/ version uses ES modules + seeded RNG + pity; this copy uses Math.random()
// for random loot drops which don't need deterministic replay or pity tracking.
//
// Each affix has:
//   minIlvl:    minimum item level required (0 = always available)
//   slotPool:   null = general (all slots), or string[] of slot names
//   sourcePool: null = general drops, or string[] of source identifiers (boss ids, etc.)
//   delta:      base stat changes (reduced to ~42% of full power; wave scaling restores them)

const ITEM_AFFIX_POOL = [
    // ── OFFENSE ─────────────────────────────────────────────────────────────
    { id: 'flat_dmg_1',      name: 'Serrated Edge',  desc: '+2 flat damage',                  category: 'offense',  weight: 10, delta: { flatDamage: 2 },            minIlvl: 0, slotPool: null, sourcePool: null },
    { id: 'flat_dmg_2',      name: 'Whetted Blade',  desc: '+5 flat damage',                  category: 'offense',  weight: 6,  delta: { flatDamage: 5 },            minIlvl: 5, slotPool: null, sourcePool: null },
    { id: 'inc_dmg_1',       name: 'Bloodlust',      desc: '8% increased damage',             category: 'offense',  weight: 8,  delta: { increased: 8 },             minIlvl: 0, slotPool: null, sourcePool: null },
    { id: 'inc_dmg_2',       name: 'Fury',           desc: '17% increased damage',            category: 'offense',  weight: 5,  delta: { increased: 17 },            minIlvl: 5, slotPool: null, sourcePool: null },
    { id: 'more_dmg_1',      name: 'Execute',        desc: '6% more damage',                  category: 'offense',  weight: 5,  delta: { more: 6 },                  minIlvl: 0, slotPool: null, sourcePool: null },
    { id: 'attack_speed_1',  name: 'Swift Strikes',  desc: '6% faster attack speed',          category: 'offense',  weight: 8,  delta: { attackSpeedMult: 0.937 },   minIlvl: 0, slotPool: null, sourcePool: null },
    { id: 'attack_speed_2',  name: 'Frenzy',         desc: '10% faster attack speed',         category: 'offense',  weight: 4,  delta: { attackSpeedMult: 0.895 },   minIlvl: 5, slotPool: null, sourcePool: null },
    { id: 'crit_chance_1',   name: 'Eagle Eye',      desc: '+3% critical strike chance',      category: 'offense',  weight: 7,  delta: { critChance: 0.03 },         minIlvl: 0, slotPool: null, sourcePool: null },
    { id: 'crit_chance_2',   name: 'Deadeye',        desc: '+8% critical strike chance',      category: 'offense',  weight: 4,  delta: { critChance: 0.08 },         minIlvl: 5, slotPool: null, sourcePool: null },
    { id: 'crit_mult_1',     name: 'Mortal Blow',    desc: '+20% critical strike multiplier', category: 'offense',  weight: 5,  delta: { critMult: 0.2 },            minIlvl: 0, slotPool: null, sourcePool: null },
    // ── DEFENSE ─────────────────────────────────────────────────────────────
    { id: 'max_hp_1',        name: 'Fortification',  desc: '+12 max health',                  category: 'defense',  weight: 10, delta: { maxHp: 12 },                minIlvl: 0, slotPool: null, sourcePool: null },
    { id: 'max_hp_2',        name: 'Iron Will',      desc: '+29 max health',                  category: 'defense',  weight: 5,  delta: { maxHp: 29 },                minIlvl: 5, slotPool: null, sourcePool: null },
    { id: 'regen_1',         name: 'Second Wind',    desc: '+1 HP regen per second',          category: 'defense',  weight: 7,  delta: { regen: 1 },                 minIlvl: 0, slotPool: null, sourcePool: null },
    { id: 'regen_2',         name: 'Unbreakable',    desc: '+2.5 HP regen per second',        category: 'defense',  weight: 4,  delta: { regen: 2.5 },               minIlvl: 5, slotPool: null, sourcePool: null },
    { id: 'life_steal_1',    name: 'Vampiric',       desc: '+1 life on kill',                 category: 'defense',  weight: 6,  delta: { lifeSteal: 1 },             minIlvl: 0, slotPool: null, sourcePool: null },
    // ── UTILITY ─────────────────────────────────────────────────────────────
    { id: 'speed_1',         name: 'Fleet Foot',     desc: '+6% movement speed',              category: 'utility',  weight: 8,  delta: { speedMult: 1.063 },         minIlvl: 0, slotPool: null, sourcePool: null },
    { id: 'speed_2',         name: 'Windrunner',     desc: '+13% movement speed',             category: 'utility',  weight: 4,  delta: { speedMult: 1.126 },         minIlvl: 5, slotPool: null, sourcePool: null },
    { id: 'range_1',         name: 'Far Reach',      desc: '+1 attack range',                 category: 'utility',  weight: 7,  delta: { attackRange: 1 },           minIlvl: 0, slotPool: null, sourcePool: null },
    { id: 'magnet_1',        name: 'Magnetism',      desc: '+2 pickup magnet radius',         category: 'utility',  weight: 6,  delta: { magnetRadius: 2 },          minIlvl: 0, slotPool: null, sourcePool: null },
    { id: 'xp_1',            name: 'Studious',       desc: '+8% XP gain',                     category: 'utility',  weight: 6,  delta: { xpMult: 0.08 },             minIlvl: 0, slotPool: null, sourcePool: null },

    // ── SLOT-SPECIFIC (future) ──────────────────────────────────────────────
    // Add entries with slotPool: ['feet'] etc. Examples:
    // { id: 'boot_speed_1', name: 'Strider', desc: '+4% movement speed',
    //   category: 'utility', weight: 8, delta: { speedMult: 1.04 },
    //   minIlvl: 0, slotPool: ['feet'], sourcePool: null },
    // { id: 'weapon_flat_1', name: 'Keen Edge', desc: '+3 flat damage',
    //   category: 'offense', weight: 8, delta: { flatDamage: 3 },
    //   minIlvl: 0, slotPool: ['weapon'], sourcePool: null },

    // ── SOURCE-SPECIFIC (future) ────────────────────────────────────────────
    // Add entries with sourcePool: ['boss_skeleton_king'] etc. Examples:
    // { id: 'boss_execute', name: 'Regicide', desc: '10% more damage',
    //   category: 'offense', weight: 5, delta: { more: 10 },
    //   minIlvl: 0, slotPool: null, sourcePool: ['boss_skeleton_king'] },
];

// Identity values for multiplicative stats — used by wave scaling
const MULT_IDENTITY = {
    speedMult: 1.0,
    attackSpeedMult: 1.0
};

// Affix count ranges by rarity
const AFFIX_COUNTS = {
    common:    { min: 1, max: 1 },
    uncommon:  { min: 1, max: 2 },
    rare:      { min: 2, max: 3 },
    epic:      { min: 3, max: 4 },
    legendary: { min: 4, max: 4 }
};

// Scale an affix's delta values based on wave number.
// Additive stats scale linearly; multiplicative stats scale the magnitude from identity.
function scaleAffixDelta(baseDelta, wave) {
    const multiplier = 1 + (wave - 1) * CONFIG.items.scaling.scaleFactor;
    const scaled = {};
    for (const [key, value] of Object.entries(baseDelta)) {
        if (key in MULT_IDENTITY) {
            const identity = MULT_IDENTITY[key];
            const magnitude = value - identity;
            scaled[key] = identity + magnitude * multiplier;
        } else {
            scaled[key] = Math.round(value * multiplier * 100) / 100;
        }
    }
    return scaled;
}

// Generate a human-readable description from a (possibly scaled) delta object.
function formatAffixDesc(delta) {
    const formatters = {
        flatDamage:      v => `+${Math.round(v)} flat damage`,
        increased:       v => `${Math.round(v)}% increased damage`,
        more:            v => `${Math.round(v)}% more damage`,
        critChance:      v => `+${Math.round(v * 100)}% critical strike chance`,
        critMult:        v => `+${Math.round(v * 100)}% critical strike multiplier`,
        maxHp:           v => `+${Math.round(v)} max health`,
        regen:           v => `+${+(v.toFixed(1))} HP regen per second`,
        lifeSteal:       v => `+${Math.round(v)} life on kill`,
        speedMult:       v => `+${Math.round((v - 1) * 100)}% movement speed`,
        attackSpeedMult: v => `${Math.round((1 - v) * 100)}% faster attack speed`,
        attackRange:     v => `+${Math.round(v)} attack range`,
        magnetRadius:    v => `+${Math.round(v)} pickup magnet radius`,
        xpMult:          v => `+${Math.round(v * 100)}% XP gain`,
    };
    return Object.entries(delta)
        .map(([k, v]) => (formatters[k] ? formatters[k](v) : `${k}: ${v}`))
        .join(', ');
}

// Item class for managing equipment and inventory items
class Item {
    constructor(config) {
        this.id = Math.random().toString(36).substr(2, 9); // Unique ID
        this.name = config.name || 'Unknown Item';
        this.rarity = config.rarity || 'common';
        this.slotType = config.slotType || 'weapon'; // Which equipment slot it goes in
        this.icon = config.icon || CONFIG.items.genericIcon;
        this.affixes = config.affixes || [];
        this.ilvl = config.ilvl || 1;

        // Stats will be derived from affixes at equip time
        this.stats = config.stats || {};

        // For display/pickup purposes
        this.rarityConfig = CONFIG.items.rarities[this.rarity];
    }

    // Get a display string for the item
    getDisplayName() {
        return `${this.icon} ${this.name}`;
    }

    // Get the rarity color
    getRarityColor() {
        return this.rarityConfig.color;
    }

    // Clone this item
    clone() {
        return new Item({
            name: this.name,
            rarity: this.rarity,
            slotType: this.slotType,
            icon: this.icon,
            stats: { ...this.stats },
            affixes: this.affixes.map(a => ({ ...a, delta: { ...a.delta } })),
            ilvl: this.ilvl
        });
    }
}

// Item generator - creates random items
class ItemGenerator {
    // Roll a random rarity based on weights
    static rollRarity() {
        const rarities = CONFIG.items.rarities;
        const totalWeight = Object.values(rarities).reduce((sum, r) => sum + r.weight, 0);
        let roll = Math.random() * totalWeight;

        for (const [name, config] of Object.entries(rarities)) {
            roll -= config.weight;
            if (roll <= 0) {
                return name;
            }
        }
        return 'common'; // Fallback
    }

    // Resolve the available affix pool for a given slot, item level, and drop source.
    // Filters by ilvl requirement, slot affinity, and source affinity.
    static resolveAffixPool(slotType, ilvl, sourceId = null) {
        return ITEM_AFFIX_POOL.filter(a => {
            if ((a.minIlvl || 0) > ilvl) return false;
            if (a.slotPool !== null && !a.slotPool.includes(slotType)) return false;
            if (a.sourcePool !== null && (!sourceId || !a.sourcePool.includes(sourceId))) return false;
            return true;
        });
    }

    // Roll affixes for an item based on rarity, slot, ilvl, wave, and optional source.
    static rollAffixes(rarity, slotType, ilvl, wave, sourceId = null) {
        const counts = AFFIX_COUNTS[rarity] || AFFIX_COUNTS.common;
        const count = counts.min + Math.floor(Math.random() * (counts.max - counts.min + 1));

        const pool = this.resolveAffixPool(slotType, ilvl, sourceId);
        const picked = [];
        const usedIds = new Set();

        for (let i = 0; i < count; i++) {
            // Filter out already-picked affixes
            const available = pool.filter(a => !usedIds.has(a.id));
            if (available.length === 0) break;

            // Weighted random pick
            const totalWeight = available.reduce((sum, a) => sum + a.weight, 0);
            let roll = Math.random() * totalWeight;
            let chosen = available[0];
            for (const affix of available) {
                roll -= affix.weight;
                if (roll <= 0) {
                    chosen = affix;
                    break;
                }
            }

            // Scale the delta by wave and generate dynamic description
            const scaledDelta = scaleAffixDelta(chosen.delta, wave);
            const scaledAffix = {
                ...chosen,
                delta: scaledDelta,
                desc: formatAffixDesc(scaledDelta)
            };

            picked.push(scaledAffix);
            usedIds.add(chosen.id);
        }

        return picked;
    }

    // Generate a random item
    static generateItem(opts = {}) {
        const wave = opts.wave || 1;
        const sourceId = opts.sourceId || null;
        const ilvl = wave; // 1:1 mapping for now; can add a formula later

        const rarity = this.rollRarity();
        const slotTypes = CONFIG.items.slotTypes;
        const slotType = slotTypes[Math.floor(Math.random() * slotTypes.length)];
        const affixes = this.rollAffixes(rarity, slotType, ilvl, wave, sourceId);

        return new Item({
            name: this.generateName(slotType, rarity),
            rarity: rarity,
            slotType: slotType,
            icon: CONFIG.items.genericIcon,
            affixes: affixes,
            stats: {},
            ilvl: ilvl
        });
    }

    // Generate a name for the item
    static generateName(slotType, rarity) {
        const prefixes = {
            common: ['Simple', 'Basic', 'Plain', 'Standard'],
            uncommon: ['Fine', 'Quality', 'Superior', 'Improved'],
            rare: ['Rare', 'Exceptional', 'Pristine', 'Reinforced'],
            epic: ['Epic', 'Magnificent', 'Glorious', 'Empowered'],
            legendary: ['Legendary', 'Mythical', 'Ancient', 'Divine']
        };

        const slotNames = {
            head: 'Helmet',
            chest: 'Armor',
            hands: 'Gauntlets',
            legs: 'Greaves',
            feet: 'Boots',
            weapon: 'Weapon',
            offhand: 'Shield',
            ring1: 'Ring',
            ring2: 'Ring',
            amulet: 'Amulet'
        };

        const prefix = prefixes[rarity][Math.floor(Math.random() * prefixes[rarity].length)];
        const baseName = slotNames[slotType];

        return `${prefix} ${baseName}`;
    }

    // Check if an item should drop from an enemy
    static shouldDropItem(enemyType) {
        const dropChance = CONFIG.items.dropChances[enemyType] || 0.05;
        return Math.random() < dropChance;
    }
}
