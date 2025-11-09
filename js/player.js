// Player Class
class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.rangeIndicator = null;
        this.keys = {};

        // Player stats
        this.stats = {
            health: CONFIG.player.initialHealth,
            maxHealth: CONFIG.player.initialHealth,
            speed: CONFIG.player.initialSpeed,
            damage: CONFIG.player.initialDamage,
            attackSpeed: CONFIG.player.initialAttackSpeed,
            lastAttack: 0,
            attackRange: CONFIG.player.initialAttackRange,
            xp: 0,
            xpToNext: CONFIG.progression.xpBase,
            gold: 0,
            pickupRadius: CONFIG.player.pickupRadius,
            magnetRadius: CONFIG.player.magnetRadius,
            lifeSteal: 0,
            critChance: 0,
            piercing: 0,
            regen: 0,
            lastRegen: 0
        };

        this.level = 1;
        this.rangeUpdated = false;

        this.createMesh();
        this.setupInput();
    }

    createMesh() {
        const player = BABYLON.MeshBuilder.CreateBox("player", {size: 1}, this.scene);
        player.position.y = 0.5;

        const playerMat = new BABYLON.StandardMaterial("playerMat", this.scene);
        playerMat.diffuseColor = new BABYLON.Color3(0.2, 0.5, 1);
        playerMat.emissiveColor = new BABYLON.Color3(0.1, 0.2, 0.5);
        player.material = playerMat;

        // Direction indicator
        const indicator = BABYLON.MeshBuilder.CreateBox(
            "indicator",
            {width: 0.2, height: 0.2, depth: 0.5},
            this.scene
        );
        indicator.position.z = 0.7;
        indicator.position.y = 0.3;
        indicator.parent = player;

        const indicatorMat = new BABYLON.StandardMaterial("indicatorMat", this.scene);
        indicatorMat.diffuseColor = new BABYLON.Color3(1, 1, 0);
        indicatorMat.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0);
        indicator.material = indicatorMat;

        // Attack range indicator
        if (CONFIG.player.showRangeIndicator) {
            this.createRangeIndicator();
        }

        this.mesh = player;
    }

    createRangeIndicator() {
        if (this.rangeIndicator) {
            this.rangeIndicator.dispose();
        }

        const rangeIndicator = BABYLON.MeshBuilder.CreateTorus(
            "rangeIndicator",
            {
                diameter: this.stats.attackRange * 2,
                thickness: 0.1,
                tessellation: 32
            },
            this.scene
        );
        rangeIndicator.position.y = 0.05;
        rangeIndicator.parent = this.mesh;

        const rangeMat = new BABYLON.StandardMaterial("rangeMat", this.scene);
        rangeMat.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.8);
        rangeMat.alpha = 0.2;
        rangeIndicator.material = rangeMat;

        this.rangeIndicator = rangeIndicator;
    }

    setupInput() {
        window.addEventListener("keydown", (e) => {
            this.keys[e.key.toLowerCase()] = true;
        });

        window.addEventListener("keyup", (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
    }

    update(camera) {
        const moveVector = new BABYLON.Vector3(0, 0, 0);

        if (this.keys['w'] || this.keys['arrowup']) moveVector.z += 1;
        if (this.keys['s'] || this.keys['arrowdown']) moveVector.z -= 1;
        if (this.keys['a'] || this.keys['arrowleft']) moveVector.x -= 1;
        if (this.keys['d'] || this.keys['arrowright']) moveVector.x += 1;

        if (moveVector.length() > 0) {
            moveVector.normalize();
            this.mesh.position.addInPlace(
                moveVector.scale(this.stats.speed)
            );

            // Keep player in bounds
            const maxDist = CONFIG.world.groundSize / 2 - 1;
            this.mesh.position.x = Math.max(-maxDist,
                Math.min(maxDist, this.mesh.position.x));
            this.mesh.position.z = Math.max(-maxDist,
                Math.min(maxDist, this.mesh.position.z));

            // Rotate to face movement direction
            if (moveVector.length() > 0.1) {
                const angle = Math.atan2(moveVector.x, moveVector.z);
                this.mesh.rotation.y = angle;
            }
        }

        // Camera follow
        if (camera) {
            camera.position.x = this.mesh.position.x;
            camera.position.z = this.mesh.position.z - CONFIG.world.cameraOffset;
        }

        // Handle regeneration
        const currentTime = Date.now();
        if (this.stats.regen > 0 && currentTime - this.stats.lastRegen > 1000) {
            this.stats.health = Math.min(
                this.stats.health + this.stats.regen,
                this.stats.maxHealth
            );
            this.stats.lastRegen = currentTime;
        }

        // Check for range updates
        if (this.rangeUpdated) {
            this.createRangeIndicator();
            this.rangeUpdated = false;
        }
    }

    takeDamage(amount) {
        this.stats.health -= amount;
        return this.stats.health <= 0;
    }

    heal(amount) {
        this.stats.health = Math.min(
            this.stats.health + amount,
            this.stats.maxHealth
        );
    }

    addXP(amount) {
        this.stats.xp += amount;

        // Check level up
        const levelsGained = [];
        while (this.stats.xp >= this.stats.xpToNext) {
            this.stats.xp -= this.stats.xpToNext;
            this.levelUp();
            levelsGained.push(this.level);
        }

        return levelsGained;
    }

    addGold(amount) {
        this.stats.gold += amount;
    }

    levelUp() {
        this.level++;
        this.stats.xpToNext = Math.floor(
            this.stats.xpToNext * CONFIG.progression.xpMultiplier
        );

        // Base stat improvements
        this.stats.damage += CONFIG.player.levelUpDamageBonus;
        this.stats.attackSpeed = Math.max(
            CONFIG.player.minAttackSpeed,
            this.stats.attackSpeed - CONFIG.player.attackSpeedReduction
        );
        this.stats.maxHealth += CONFIG.player.levelUpHealthBonus;
        this.stats.health = Math.min(
            this.stats.health + CONFIG.player.levelUpHeal,
            this.stats.maxHealth
        );
    }

    getPosition() {
        return this.mesh.position;
    }

    destroy() {
        if (this.rangeIndicator) {
            this.rangeIndicator.dispose();
        }
        if (this.mesh) {
            this.mesh.dispose();
        }
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Player;
}
