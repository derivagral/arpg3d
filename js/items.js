// Item class for managing equipment and inventory items
class Item {
    constructor(config) {
        this.id = Math.random().toString(36).substr(2, 9); // Unique ID
        this.name = config.name || 'Unknown Item';
        this.rarity = config.rarity || 'common';
        this.slotType = config.slotType || 'weapon'; // Which equipment slot it goes in
        this.icon = config.icon || CONFIG.items.genericIcon;

        // Stats will be filled out in future implementation
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
            stats: { ...this.stats }
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

    // Generate a random item
    static generateItem() {
        const rarity = this.rollRarity();
        const slotTypes = CONFIG.items.slotTypes;
        const slotType = slotTypes[Math.floor(Math.random() * slotTypes.length)];

        return new Item({
            name: this.generateName(slotType, rarity),
            rarity: rarity,
            slotType: slotType,
            icon: CONFIG.items.genericIcon,
            stats: {} // Stats generation to be implemented later
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
