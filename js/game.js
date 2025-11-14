// Enhanced Game Class - Refactored
class Game {
    constructor(engine, canvas) {
        this.engine = engine;
        this.canvas = canvas;

        // Initialize managers
        this.sceneManager = new SceneManager(engine);
        this.scene = this.sceneManager.getScene();
        this.camera = this.sceneManager.getCamera();

        // Initialize player
        this.player = new Player(this.scene);

        // Initialize managers that depend on game reference
        this.projectileManager = new ProjectileManager(this);
        this.pickupManager = new PickupManager(this);
        this.spawnManager = new SpawnManager(this, CONFIG.spawn);
        this.inventoryManager = new InventoryManager();
        this.areaManager = new AreaManager(this);

        // Game state
        this.state = {
            enemies: [],
            startTime: Date.now(),
            paused: false,
            upgradesPending: 0,
            inventoryOpen: false
        };

        // Shorthand for enemies (for compatibility)
        this.enemies = this.state.enemies;

        // UI
        this.ui = new UIManager(this);

        // Initialize area system (starts at home base)
        this.areaManager.initialize();

        this.setupInput();
        this.startGameLoop();
    }

    setupInput() {
        window.addEventListener("keydown", (e) => {
            const key = e.key.toLowerCase();

            // Toggle inventory on I
            if (key === 'i') {
                this.toggleInventory();
                return;
            }

            // Pause on ESC or P (but not if inventory is open)
            if (key === 'escape' || key === 'p') {
                if (this.state.inventoryOpen) {
                    // ESC closes inventory
                    this.toggleInventory();
                } else {
                    this.togglePause();
                }
                return;
            }
        });
    }

    togglePause() {
        this.state.paused = !this.state.paused;

        if (this.state.paused) {
            this.ui.showPauseOverlay();

            // Check for pending upgrades
            if (this.state.upgradesPending > 0) {
                this.ui.showUpgradeMenu();
            }
        } else {
            this.ui.hidePauseOverlay();
            this.ui.hideUpgradeMenu();
        }
    }

    toggleInventory() {
        this.state.inventoryOpen = !this.state.inventoryOpen;

        if (this.state.inventoryOpen) {
            // Open inventory and pause the game
            this.state.paused = true;
            this.ui.showInventory();
        } else {
            // Close inventory and unpause the game
            this.state.paused = false;
            this.ui.hideInventory();
        }
    }


    findNearestEnemy() {
        let nearest = null;
        let minDist = Infinity;

        this.state.enemies.forEach(enemy => {
            const dist = BABYLON.Vector3.Distance(
                this.player.mesh.position,
                enemy.mesh.position
            );
            if (dist < minDist && dist <= this.player.stats.attackRange) {
                minDist = dist;
                nearest = enemy;
            }
        });

        return nearest;
    }

    updatePlayer() {
        if (this.state.paused) return;
        this.player.update(this.camera);
    }

    updateEnemies(currentTime) {
        if (this.state.paused) return;

        this.state.enemies = this.state.enemies.filter(enemy => {
            // Update enemy (movement and actions)
            enemy.update(this, currentTime);

            // Check collision with player
            const distToPlayer = BABYLON.Vector3.Distance(
                enemy.mesh.position,
                this.player.mesh.position
            );

            if (distToPlayer < 1) {
                this.player.takeDamage(enemy.damage);
                this.ui.updateHealthBar();
                this.pickupManager.createPickup(enemy.mesh.position, 'xp', enemy.xpValue);

                // Check for gold drop
                const goldDropChance = CONFIG.currency.dropChances[enemy.type] || 0.3;
                if (Math.random() < goldDropChance) {
                    const goldRange = CONFIG.currency.goldAmounts[enemy.type] || { min: 1, max: 3 };
                    const goldAmount = Math.floor(Math.random() * (goldRange.max - goldRange.min + 1)) + goldRange.min;
                    this.pickupManager.createPickup(enemy.mesh.position, 'gold', goldAmount);
                }

                // Check for item drop
                if (ItemGenerator.shouldDropItem(enemy.type)) {
                    const item = ItemGenerator.generateItem();
                    this.pickupManager.createPickup(enemy.mesh.position, 'item', item);
                }

                enemy.destroy();
                return false;
            }

            return true;
        });
    }

    updateProjectiles() {
        if (this.state.paused) return;

        // Update player projectiles
        this.projectileManager.update(
            this.state.enemies,
            this.player.mesh,
            // onEnemyKilled callback
            (enemy, position) => {
                this.pickupManager.createPickup(position, 'xp', enemy.xpValue);
                if (Math.random() < CONFIG.pickups.health.dropChance) {
                    this.pickupManager.createPickup(position, 'health');
                }

                // Check for gold drop
                const goldDropChance = CONFIG.currency.dropChances[enemy.type] || 0.3;
                if (Math.random() < goldDropChance) {
                    const goldRange = CONFIG.currency.goldAmounts[enemy.type] || { min: 1, max: 3 };
                    const goldAmount = Math.floor(Math.random() * (goldRange.max - goldRange.min + 1)) + goldRange.min;
                    this.pickupManager.createPickup(position, 'gold', goldAmount);
                }

                // Check for item drop
                if (ItemGenerator.shouldDropItem(enemy.type)) {
                    const item = ItemGenerator.generateItem();
                    this.pickupManager.createPickup(position, 'item', item);
                }
            },
            // onLifeSteal callback
            () => {
                if (this.player.stats.lifeSteal > 0) {
                    this.player.heal(this.player.stats.lifeSteal);
                    this.ui.updateHealthBar();
                }
            }
        );

        // Update enemy projectiles
        this.projectileManager.updateEnemyProjectiles(
            this.player.mesh,
            (damage) => {
                this.player.takeDamage(damage);
                this.ui.updateHealthBar();
            }
        );
    }

    updatePickups() {
        if (this.state.paused) return;

        this.pickupManager.update(
            this.player.mesh,
            this.player.stats,
            // onXPCollected callback
            (value) => {
                const levelsGained = this.player.addXP(value);

                // Handle level ups
                levelsGained.forEach(() => {
                    this.state.upgradesPending++;
                    this.togglePause();
                    this.ui.updateHealthBar();
                    this.ui.animateLevelUp();
                });
            },
            // onHealthCollected callback
            (value) => {
                this.player.heal(value);
                this.ui.updateHealthBar();
            },
            // onItemCollected callback
            (item) => {
                if (this.inventoryManager.addItem(item)) {
                    this.ui.updateInventoryDisplay();
                }
            },
            // onGoldCollected callback
            (value) => {
                this.player.addGold(value);
            },
            // inventoryFull flag
            this.inventoryManager.isFull()
        );
    }

    updateWaveSystem(currentTime) {
        if (this.state.paused) return;

        // Track previous wave to detect changes
        const previousWave = this.spawnManager.currentWave;

        // Update spawn manager (handles wave progression and spawning)
        this.spawnManager.update(currentTime, this.player, this.state.enemies);

        // Show wave indicator if wave changed
        if (this.spawnManager.currentWave !== previousWave) {
            this.ui.showWaveIndicator(this.spawnManager.currentWave);
            this.ui.updateStats();
        }
    }

    autoAttack(currentTime) {
        if (this.state.paused) return;

        // Update cooldown bar
        const cooldownProgress = Math.min(1,
            (currentTime - this.player.stats.lastAttack) / this.player.stats.attackSpeed
        );
        this.ui.updateCooldownBar(cooldownProgress);

        if (currentTime - this.player.stats.lastAttack > this.player.stats.attackSpeed) {
            const target = this.findNearestEnemy();
            if (target) {
                this.projectileManager.createProjectile(
                    this.player.mesh.position,
                    target.mesh.position,
                    this.player.stats
                );
                this.player.stats.lastAttack = currentTime;
            }
        }
    }

    checkGameOver() {
        if (this.player.stats.health <= 0) {
            const survivalTime = this.formatTime(Date.now() - this.state.startTime);
            alert(`Game Over!\nSurvived: ${survivalTime}\nWave: ${this.spawnManager.currentWave}\nLevel: ${this.player.level}`);
            location.reload();
        }
    }

    formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    startGameLoop() {
        this.scene.registerBeforeRender(() => {
            const currentTime = Date.now();
            const deltaTime = this.engine.getDeltaTime();

            // Update area manager (handles portals and transitions)
            this.areaManager.update(deltaTime);

            this.updatePlayer();
            this.updateWaveSystem(currentTime);
            this.autoAttack(currentTime);
            this.updateEnemies(currentTime);
            this.updateProjectiles();
            this.updatePickups();
            this.ui.updateStats();
            this.checkGameOver();
        });
    }

    start() {
        this.engine.runRenderLoop(() => {
            if (!this.state.paused || this.state.upgradesPending > 0) {
                this.scene.render();
            }
        });

        window.addEventListener("resize", () => {
            this.engine.resize();
        });
    }
}
