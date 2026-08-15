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
        this.indicatorManager = new AttackIndicatorManager(this.scene);
        this.areaManager = new AreaManager(this);
        this.markerManager = new MarkerManager(this);

        // Game state
        this.state = {
            enemies: [],
            startTime: Date.now(),
            paused: false,
            upgradesPending: 0,
            inventoryOpen: false,
            atStash: false,
            stashOpen: false
        };

        // Item drops produced by the sim, waiting to be shown as world pickups.
        // The sim is the only thing that rolls items — see handleEnemyDeath.
        this.simDropQueue = [];

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

            // Open the stash on E, but only while standing at it. Requiring a
            // key press (unlike portals, which trigger on contact) means you
            // can walk past your storage without being pulled into a menu.
            if (key === 'e') {
                if (this.areaManager && this.areaManager.isAtStash() && !this.state.inventoryOpen) {
                    this.openStash();
                }
                return;
            }

            // The stash panel owns the screen while open and handles its own
            // keys; don't let ESC/P unpause the game behind it.
            if (this.state.stashOpen) return;

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

    /**
     * Open the Bag/Stash/Equipment screen. The panel itself is an ES module
     * (src/ui/stashPanel.js) wired up in src/main.js, which installs
     * openStashPanel() on this instance — it reads canonical sim/profile
     * state, unlike the older legacy inventory screen on I.
     */
    openStash() {
        if (!this.openStashPanel) return;
        this.state.atStash = true;
        this.state.stashOpen = true;
        if (this.ui.hideInteractionPrompt) this.ui.hideInteractionPrompt();
        this.openStashPanel();
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
            this.state.atStash = false;
            this.ui.hideInventory();
        }
    }


    getDropMultiplier(enemy) {
        return enemy.isElite ? CONFIG.elite.dropBonusMultiplier : 1;
    }

    handleEnemyDeath(enemy, position) {
        const dropMult = this.getDropMultiplier(enemy);
        const goldFind = this.player.stats.goldFind || 1;
        const itemFind = this.player.stats.itemFind || 1;

        // Notify in-map objectives of the kill (used for "clear N in zone" goals).
        if (this.markerManager) {
            this.markerManager.onEnemyKilled(enemy, position);
        }

        this.pickupManager.createPickup(position, 'xp', enemy.xpValue);

        // Health drop
        if (Math.random() < CONFIG.pickups.health.dropChance * dropMult) {
            this.pickupManager.createPickup(position, 'health');
        }

        // Gold drop (scaled by gold-find buffs)
        const goldDropChance = (CONFIG.currency.dropChances[enemy.type] || 0.3) * dropMult * goldFind;
        if (Math.random() < goldDropChance) {
            const goldRange = CONFIG.currency.goldAmounts[enemy.type] || { min: 1, max: 3 };
            const baseGold = Math.floor(Math.random() * (goldRange.max - goldRange.min + 1)) + goldRange.min;
            const goldAmount = Math.max(1, Math.round(baseGold * goldFind));
            this.pickupManager.createPickup(position, 'gold', goldAmount);
        }

        // Item drop — DISPLAY ONLY.
        //
        // The sim rolls every item (seeded, deterministic) and banks it into
        // the run bag the moment it drops. This layer used to roll a second,
        // parallel item with Math.random() and its own generator, so the loot
        // you saw on the ground had nothing to do with the loot you owned.
        // Now src/main.js drains the sim's item_drop events into simDropQueue
        // and we simply show the next one at this corpse. Picking it up is a
        // visual flourish; the item is already yours.
        const simDrop = this.simDropQueue.shift();
        if (simDrop) {
            this.pickupManager.createPickup(position, 'item', simDrop);
        }

        // Special death effects
        if (enemy._pendingExplosion && enemy.triggerTelegraphedExplosion) {
            enemy.triggerTelegraphedExplosion(this);
        }
        if (enemy._pendingSplit && enemy.getDeathEffects) {
            enemy.getDeathEffects(this);
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

        // Enemies in contact persist and swing on their own cooldown; only
        // player damage kills them. Death-on-contact used to consume the
        // enemy AND pay out a full kill reward, which let ehp builds clear
        // waves by standing still and inflated the economy.
        // Mirrors the sim melee model (sim/engine.js).
        const contact = [];
        for (const enemy of this.state.enemies) {
            enemy.update(this, currentTime);

            const distToPlayer = BABYLON.Vector3.Distance(
                enemy.mesh.position,
                this.player.mesh.position
            );
            if (distToPlayer < 1) contact.push({ enemy, distToPlayer });
        }

        // Surround limit: only the closest N enemies can attack at once,
        // so incoming dps doesn't scale with the size of the pile.
        contact.sort((a, b) => a.distToPlayer - b.distToPlayer);
        for (const { enemy } of contact.slice(0, CONFIG.combat.engagementSlots)) {
            if (currentTime - enemy.lastHitTime < enemy.attackMs) continue;
            enemy.lastHitTime = currentTime;

            this.player.lastDamageSource = {
                name: enemy.name || enemy.type || 'Enemy',
                damage: enemy.damage,
                type: 'contact'
            };
            this.player.takeDamage(enemy.damage);
            this.ui.updateHealthBar();
        }
    }

    updateProjectiles() {
        if (this.state.paused) return;

        // Update player projectiles
        this.projectileManager.update(
            this.state.enemies,
            this.player.mesh,
            // onEnemyKilled callback
            (enemy, position) => {
                this.handleEnemyDeath(enemy, position);
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
            (damage, sourceName) => {
                this.player.lastDamageSource = {
                    name: sourceName || 'Projectile',
                    damage: damage,
                    type: 'projectile'
                };
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
                // Sim-owned drops are already in the run bag; collecting the
                // mesh is purely cosmetic. Never re-add, or the item would
                // exist twice.
                if (item && item.fromSim) {
                    if (this.ui.flashLoot) this.ui.flashLoot(item);
                    return true;
                }

                const result = this.inventoryManager.addItem(item);

                if (result === true) {
                    this.ui.updateInventoryDisplay();
                    return true;
                }

                if (result === 'destroyed') {
                    this.ui.updateInventoryDisplay();
                    return true;
                }

                return false;
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
                const from = this.player.mesh.position;
                const baseDirection = target.mesh.position.subtract(from).normalize();
                const projectileCount = Math.max(1, this.player.stats.projectileCount || 1);
                const totalSpread = 0.35;

                for (let i = 0; i < projectileCount; i++) {
                    const offset = projectileCount === 1
                        ? 0
                        : (i - (projectileCount - 1) / 2) * (totalSpread / (projectileCount - 1));
                    const cos = Math.cos(offset);
                    const sin = Math.sin(offset);

                    const spreadDirection = new BABYLON.Vector3(
                        baseDirection.x * cos - baseDirection.z * sin,
                        baseDirection.y,
                        baseDirection.x * sin + baseDirection.z * cos
                    );

                    const targetPos = from.add(spreadDirection.scale(this.player.stats.attackRange));
                    this.projectileManager.createProjectile(from, targetPos, this.player.stats);
                }

                this.player.stats.lastAttack = currentTime;
            }
        }
    }

    checkGameOver() {
        if (this.player.stats.health <= 0) {
            const survivalTime = this.formatTime(Date.now() - this.state.startTime);
            const src = this.player.lastDamageSource;
            const killedBy = src
                ? `Killed by: ${src.name} (${src.damage} dmg, ${src.type})`
                : 'Killed by: Unknown';
            alert(`Game Over!\nSurvived: ${survivalTime}\nWave: ${this.spawnManager.currentWave}\nLevel: ${this.player.level}\n${killedBy}`);
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

            // Update in-map objective markers (area checks, timers, buffs)
            if (!this.state.paused) {
                this.markerManager.update(deltaTime);
            }

            this.updatePlayer();
            this.updateWaveSystem(currentTime);
            this.autoAttack(currentTime);
            this.updateEnemies(currentTime);
            this.updateProjectiles();
            this.updatePickups();
            this.indicatorManager.update();
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
