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
            projectileCount: 1,
            regen: 0,
            lastRegen: 0
        };

        // Base stats are the "pre-equipment" values — modified by level-ups and upgrades.
        // Effective stats in this.stats are recomputed via applyEquipmentBonuses().
        this.baseStats = { ...this.stats };

        this.level = 1;
        this.rangeUpdated = false;
        this.lastDamageSource = null; // { name, damage, type } — what last hit us

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

        this.mesh = player;

        // Attack range indicator — must be after this.mesh is set so parent works
        if (CONFIG.player.showRangeIndicator) {
            this.createRangeIndicator();
        }
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
        rangeIndicator.position.y = 0.1;
        rangeIndicator.parent = this.mesh;

        const rangeMat = new BABYLON.StandardMaterial("rangeMat", this.scene);
        rangeMat.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.8);
        rangeMat.alpha = 0.2;
        rangeMat.disableDepthWrite = true; // Prevent Z-fighting with transparent materials
        rangeIndicator.material = rangeMat;
        rangeIndicator.renderingGroupId = 1; // Render after opaque objects

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
        this.baseStats.xpToNext = this.stats.xpToNext;

        // Base stat improvements (modify baseStats, then recompute effective)
        this.baseStats.damage += CONFIG.player.levelUpDamageBonus;
        this.baseStats.attackSpeed = Math.max(
            CONFIG.player.minAttackSpeed,
            this.baseStats.attackSpeed - CONFIG.player.attackSpeedReduction
        );
        this.baseStats.maxHealth += CONFIG.player.levelUpHealthBonus;

        // Copy base changes to stats (equipment recomputation will override these)
        this.stats.damage = this.baseStats.damage;
        this.stats.attackSpeed = this.baseStats.attackSpeed;
        this.stats.maxHealth = this.baseStats.maxHealth;
        this.stats.health = Math.min(
            this.stats.health + CONFIG.player.levelUpHeal,
            this.stats.maxHealth
        );
    }

    // Recompute effective stats from baseStats + equipment bonuses
    applyEquipmentBonuses(bonuses) {
        const base = this.baseStats;

        // Damage pipeline: (baseDamage + flat) * (1 + increased/100) * product(1 + more/100)
        let dmg = base.damage + bonuses.flatDamage;
        dmg *= (1 + bonuses.increased / 100);
        for (const m of bonuses.more) dmg *= (1 + m / 100);
        this.stats.damage = Math.round(dmg);

        // Multiplicative stats
        this.stats.speed = base.speed * bonuses.speedMult;
        this.stats.attackSpeed = Math.round(base.attackSpeed * bonuses.attackSpeedMult);

        // Additive stats
        this.stats.maxHealth = base.maxHealth + bonuses.maxHp;
        this.stats.regen = base.regen + bonuses.regen;
        this.stats.lifeSteal = base.lifeSteal + bonuses.lifeSteal;
        this.stats.attackRange = base.attackRange + bonuses.attackRange;
        this.stats.magnetRadius = base.magnetRadius + bonuses.magnetRadius;
        this.stats.critChance = Math.min(1, base.critChance + bonuses.critChance);
        this.stats.piercing = base.piercing + (bonuses.piercing || 0);
        this.stats.projectileCount = Math.max(1, Math.floor(base.projectileCount + (bonuses.projectileCount || 0)));

        // Clamp health to new max
        if (this.stats.health > this.stats.maxHealth) {
            this.stats.health = this.stats.maxHealth;
        }

        // Flag range visual update if range changed
        this.rangeUpdated = true;
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
