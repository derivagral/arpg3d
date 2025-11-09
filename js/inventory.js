// Inventory Manager - handles player inventory and equipment
class InventoryManager {
    constructor() {
        this.maxSlots = 24; // Matches the UI
        this.items = new Array(this.maxSlots).fill(null);

        // Equipment slots - 10 total
        this.equipment = {
            head: null,
            chest: null,
            hands: null,
            legs: null,
            feet: null,
            weapon: null,
            offhand: null,
            ring1: null,
            ring2: null,
            amulet: null
        };
    }

    // Check if inventory has space
    hasSpace() {
        return this.items.some(slot => slot === null);
    }

    // Get the first empty slot index
    getFirstEmptySlot() {
        return this.items.findIndex(slot => slot === null);
    }

    // Add an item to the inventory
    addItem(item) {
        if (!this.hasSpace()) {
            return false; // Inventory full
        }

        const slotIndex = this.getFirstEmptySlot();
        this.items[slotIndex] = item;
        return true;
    }

    // Remove an item from inventory by slot index
    removeItem(slotIndex) {
        if (slotIndex >= 0 && slotIndex < this.maxSlots) {
            const item = this.items[slotIndex];
            this.items[slotIndex] = null;
            return item;
        }
        return null;
    }

    // Get item at slot index
    getItem(slotIndex) {
        if (slotIndex >= 0 && slotIndex < this.maxSlots) {
            return this.items[slotIndex];
        }
        return null;
    }

    // Equip an item from inventory
    equipItem(slotIndex) {
        const item = this.getItem(slotIndex);
        if (!item) return null;

        // Check if the slot type is valid
        if (!this.equipment.hasOwnProperty(item.slotType)) {
            return null;
        }

        // Unequip current item in that slot if exists
        const currentEquipped = this.equipment[item.slotType];

        // Remove item from inventory
        this.removeItem(slotIndex);

        // Equip the new item
        this.equipment[item.slotType] = item;

        // If there was an item equipped, add it back to inventory
        if (currentEquipped) {
            this.addItem(currentEquipped);
        }

        return item;
    }

    // Unequip an item and return it to inventory
    unequipItem(slotType) {
        const item = this.equipment[slotType];
        if (!item) return null;

        if (!this.hasSpace()) {
            return null; // Can't unequip if inventory is full
        }

        this.equipment[slotType] = null;
        this.addItem(item);
        return item;
    }

    // Get all equipped items
    getEquippedItems() {
        return this.equipment;
    }

    // Calculate total stats from equipped items
    calculateEquipmentStats() {
        const stats = {
            health: 0,
            damage: 0,
            speed: 0,
            attackSpeed: 0,
            critChance: 0,
            lifeSteal: 0,
            regen: 0
        };

        for (const item of Object.values(this.equipment)) {
            if (item && item.stats) {
                for (const [stat, value] of Object.entries(item.stats)) {
                    if (stats.hasOwnProperty(stat)) {
                        stats[stat] += value;
                    }
                }
            }
        }

        return stats;
    }

    // Get count of items in inventory
    getItemCount() {
        return this.items.filter(item => item !== null).length;
    }

    // Check if inventory is full
    isFull() {
        return !this.hasSpace();
    }
}
