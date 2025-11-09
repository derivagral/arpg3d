// Pickup Manager
class PickupManager {
    constructor(game) {
        this.game = game;
        this.pickups = [];
    }

    createPickup(position, type = 'xp', value = null) {
        const pickup = BABYLON.MeshBuilder.CreateSphere(
            "pickup",
            {diameter: CONFIG.pickups[type].size},
            this.game.scene
        );

        pickup.position = position.clone();
        pickup.position.y = 0.5;

        const pickupMat = new BABYLON.StandardMaterial("pickupMat", this.game.scene);

        // For items, use rarity color; otherwise use default pickup color
        if (type === 'item' && value && value.rarityConfig) {
            pickupMat.diffuseColor = value.rarityConfig.color;
            pickupMat.emissiveColor = value.rarityConfig.emissive;
        } else {
            pickupMat.diffuseColor = CONFIG.pickups[type].color;
            pickupMat.emissiveColor = CONFIG.pickups[type].emissive;
        }
        pickup.material = pickupMat;

        pickup.type = type;
        pickup.value = value || CONFIG.pickups[type].value;
        pickup.floatOffset = Math.random() * Math.PI * 2;

        this.pickups.push(pickup);
        return pickup;
    }

    update(playerMesh, playerStats, onXPCollected, onHealthCollected, onItemCollected, inventoryFull) {
        if (this.game.state.paused) return;

        this.pickups = this.pickups.filter(pickup => {
            // Floating animation
            pickup.position.y = 0.5 + Math.sin(
                Date.now() / CONFIG.pickups.floatSpeed + pickup.floatOffset
            ) * CONFIG.pickups.floatHeight;
            pickup.rotation.y += CONFIG.pickups.rotationSpeed;

            const distToPlayer = BABYLON.Vector3.Distance(
                pickup.position,
                playerMesh.position
            );

            // Magnetic attraction (skip for items if inventory is full)
            const shouldAttract = pickup.type !== 'item' || !inventoryFull;
            if (shouldAttract && distToPlayer < playerStats.magnetRadius) {
                const direction = playerMesh.position.subtract(pickup.position);
                direction.y = 0;
                direction.normalize();
                const speed = Math.max(0.1,
                    (playerStats.magnetRadius - distToPlayer) /
                    playerStats.magnetRadius * CONFIG.pickups.magnetSpeed
                );
                pickup.position.addInPlace(direction.scale(speed));
            }

            // Collection
            if (distToPlayer < playerStats.pickupRadius) {
                if (pickup.type === 'xp') {
                    if (onXPCollected) onXPCollected(pickup.value);
                    pickup.dispose();
                    return false;
                } else if (pickup.type === 'health') {
                    if (onHealthCollected) onHealthCollected(pickup.value);
                    pickup.dispose();
                    return false;
                } else if (pickup.type === 'item') {
                    // Only collect if inventory has space
                    if (!inventoryFull && onItemCollected) {
                        onItemCollected(pickup.value);
                        pickup.dispose();
                        return false;
                    }
                    // Keep item on ground if inventory is full
                }
            }

            return true;
        });
    }

    clear() {
        this.pickups.forEach(p => p.dispose());
        this.pickups = [];
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PickupManager;
}
