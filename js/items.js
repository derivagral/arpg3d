// Item affix pool — mirrors sim/affixes.js AFFIX_POOL data for the legacy layer.
// The sim/ version uses ES modules + seeded RNG + pity; this copy uses Math.random()
// for random loot drops which don't need deterministic replay or pity tracking.
const ITEM_AFFIX_POOL = [
    // OFFENSE
    { id: 'flat_dmg_1',      name: 'Serrated Edge',  desc: '+5 flat damage',                 category: 'offense',  weight: 10, delta: { flatDamage: 5 } },
    { id: 'flat_dmg_2',      name: 'Whetted Blade',  desc: '+12 flat damage',                category: 'offense',  weight: 6,  delta: { flatDamage: 12 } },
    { id: 'inc_dmg_1',       name: 'Bloodlust',      desc: '20% increased damage',           category: 'offense',  weight: 8,  delta: { increased: 20 } },
    { id: 'inc_dmg_2',       name: 'Fury',           desc: '40% increased damage',           category: 'offense',  weight: 5,  delta: { increased: 40 } },
    { id: 'more_dmg_1',      name: 'Execute',        desc: '15% more damage',                category: 'offense',  weight: 5,  delta: { more: 15 } },
    { id: 'attack_speed_1',  name: 'Swift Strikes',  desc: '15% faster attack speed',        category: 'offense',  weight: 8,  delta: { attackSpeedMult: 0.85 } },
    { id: 'attack_speed_2',  name: 'Frenzy',         desc: '25% faster attack speed',        category: 'offense',  weight: 4,  delta: { attackSpeedMult: 0.75 } },
    { id: 'crit_chance_1',   name: 'Eagle Eye',      desc: '+8% critical strike chance',     category: 'offense',  weight: 7,  delta: { critChance: 0.08 } },
    { id: 'crit_chance_2',   name: 'Deadeye',        desc: '+18% critical strike chance',    category: 'offense',  weight: 4,  delta: { critChance: 0.18 } },
    { id: 'crit_mult_1',     name: 'Mortal Blow',    desc: '+50% critical strike multiplier',category: 'offense',  weight: 5,  delta: { critMult: 0.5 } },
    // DEFENSE
    { id: 'max_hp_1',        name: 'Fortification',  desc: '+30 max health',                 category: 'defense',  weight: 10, delta: { maxHp: 30 } },
    { id: 'max_hp_2',        name: 'Iron Will',      desc: '+70 max health',                 category: 'defense',  weight: 5,  delta: { maxHp: 70 } },
    { id: 'regen_1',         name: 'Second Wind',    desc: '+2 HP regen per second',         category: 'defense',  weight: 7,  delta: { regen: 2 } },
    { id: 'regen_2',         name: 'Unbreakable',    desc: '+6 HP regen per second',         category: 'defense',  weight: 4,  delta: { regen: 6 } },
    { id: 'life_steal_1',    name: 'Vampiric',       desc: '+3 life on kill',                category: 'defense',  weight: 6,  delta: { lifeSteal: 3 } },
    // UTILITY
    { id: 'speed_1',         name: 'Fleet Foot',     desc: '+15% movement speed',            category: 'utility',  weight: 8,  delta: { speedMult: 1.15 } },
    { id: 'speed_2',         name: 'Windrunner',     desc: '+30% movement speed',            category: 'utility',  weight: 4,  delta: { speedMult: 1.30 } },
    { id: 'range_1',         name: 'Far Reach',      desc: '+3 attack range',                category: 'utility',  weight: 7,  delta: { attackRange: 3 } },
    { id: 'magnet_1',        name: 'Magnetism',      desc: '+4 pickup magnet radius',        category: 'utility',  weight: 6,  delta: { magnetRadius: 4 } },
    { id: 'xp_1',            name: 'Studious',       desc: '+20% XP gain',                   category: 'utility',  weight: 6,  delta: { xpMult: 0.20 } }
];

// Affix count ranges by rarity
const AFFIX_COUNTS = {
    common:    { min: 1, max: 1 },
    uncommon:  { min: 1, max: 2 },
    rare:      { min: 2, max: 3 },
    epic:      { min: 3, max: 4 },
    legendary: { min: 4, max: 4 }
};

// Item class for managing equipment and inventory items
class Item {
    constructor(config) {
        this.id = Math.random().toString(36).substr(2, 9); // Unique ID
        this.name = config.name || 'Unknown Item';
        this.rarity = config.rarity || 'common';
        this.slotType = config.slotType || 'weapon'; // Which equipment slot it goes in
        this.icon = config.icon || CONFIG.items.genericIcon;
        this.affixes = config.affixes || [];

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
            affixes: this.affixes.map(a => ({ ...a, delta: { ...a.delta } }))
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

    // Roll affixes for an item based on rarity
    static rollAffixes(rarity) {
        const counts = AFFIX_COUNTS[rarity] || AFFIX_COUNTS.common;
        const count = counts.min + Math.floor(Math.random() * (counts.max - counts.min + 1));

        const picked = [];
        const usedIds = new Set();

        for (let i = 0; i < count; i++) {
            // Filter out already-picked affixes
            const available = ITEM_AFFIX_POOL.filter(a => !usedIds.has(a.id));
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

            picked.push(chosen);
            usedIds.add(chosen.id);
        }

        return picked;
    }

    // Generate a random item
    static generateItem() {
        const rarity = this.rollRarity();
        const slotTypes = CONFIG.items.slotTypes;
        const slotType = slotTypes[Math.floor(Math.random() * slotTypes.length)];
        const affixes = this.rollAffixes(rarity);

        return new Item({
            name: this.generateName(slotType, rarity),
            rarity: rarity,
            slotType: slotType,
            icon: CONFIG.items.genericIcon,
            affixes: affixes,
            stats: {}
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
