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

        this.autoDestroyRarities = {
            common: false,
            uncommon: false,
            rare: false,
            epic: false,
            legendary: false
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
        if (item && this.isAutoDestroyEnabled(item.rarity)) {
            return 'destroyed';
        }

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

    // Calculate aggregate equipment bonuses from all equipped item affixes
    calculateEquipmentBonuses() {
        const bonuses = {
            flatDamage: 0, increased: 0, more: [],
            critChance: 0, critMult: 0,
            maxHp: 0, regen: 0, lifeSteal: 0,
            attackRange: 0, magnetRadius: 0,
            xpMult: 0, speedMult: 1, attackSpeedMult: 1
        };

        for (const item of Object.values(this.equipment)) {
            if (!item || !item.affixes) continue;
            for (const affix of item.affixes) {
                const d = affix.delta;
                if (d.flatDamage)      bonuses.flatDamage      += d.flatDamage;
                if (d.increased)       bonuses.increased       += d.increased;
                if (d.more)            bonuses.more.push(d.more);
                if (d.critChance)      bonuses.critChance      += d.critChance;
                if (d.critMult)        bonuses.critMult        += d.critMult;
                if (d.maxHp)           bonuses.maxHp           += d.maxHp;
                if (d.regen)           bonuses.regen           += d.regen;
                if (d.lifeSteal)       bonuses.lifeSteal       += d.lifeSteal;
                if (d.attackRange)     bonuses.attackRange     += d.attackRange;
                if (d.magnetRadius)    bonuses.magnetRadius    += d.magnetRadius;
                if (d.xpMult)          bonuses.xpMult          += d.xpMult;
                if (d.speedMult)       bonuses.speedMult       *= d.speedMult;
                if (d.attackSpeedMult) bonuses.attackSpeedMult *= d.attackSpeedMult;
            }
        }

        return bonuses;
    }


    isAutoDestroyEnabled(rarity) {
        if (!rarity) return false;
        return !!this.autoDestroyRarities[rarity];
    }

    toggleAutoDestroyRarity(rarity) {
        if (!Object.prototype.hasOwnProperty.call(this.autoDestroyRarities, rarity)) {
            return false;
        }

        this.autoDestroyRarities[rarity] = !this.autoDestroyRarities[rarity];
        return this.autoDestroyRarities[rarity];
    }

    setAutoDestroyRarity(rarity, enabled) {
        if (!Object.prototype.hasOwnProperty.call(this.autoDestroyRarities, rarity)) {
            return false;
        }

        this.autoDestroyRarities[rarity] = !!enabled;
        return this.autoDestroyRarities[rarity];
    }

    // Remove all inventory items of a given rarity. Returns count removed.
    removeItemsByRarity(rarity) {
        let count = 0;
        for (let i = 0; i < this.maxSlots; i++) {
            if (this.items[i] && this.items[i].rarity === rarity) {
                this.items[i] = null;
                count++;
            }
        }
        return count;
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
