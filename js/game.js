// Enhanced Game Class
class Game {
    constructor(engine, canvas) {
        this.engine = engine;
        this.canvas = canvas;
        this.scene = null;
        
        // Game state
        this.state = {
            player: {
                health: CONFIG.player.initialHealth,
                maxHealth: CONFIG.player.initialHealth,
                speed: CONFIG.player.initialSpeed,
                damage: CONFIG.player.initialDamage,
                attackSpeed: CONFIG.player.initialAttackSpeed,
                lastAttack: 0,
                attackRange: CONFIG.player.initialAttackRange,
                xp: 0,
                xpToNext: CONFIG.progression.xpBase,
                pickupRadius: CONFIG.player.pickupRadius,
                magnetRadius: CONFIG.player.magnetRadius,
                lifeSteal: 0,
                critChance: 0,
                piercing: 0,
                regen: 0,
                lastRegen: 0
            },
            enemies: [],
            projectiles: [],
            pickups: [],
            startTime: Date.now(),
            level: 1,
            currentWave: 1,
            waveStartTime: Date.now(),
            lastEnemySpawn: 0,
            keys: {},
            playerMesh: null,
            rangeIndicator: null,
            paused: false,
            upgradesPending: 0,
            rangeUpdated: false
        };
        
        this.initScene();
        this.setupInput();
        this.startGameLoop();
    }
    
    initScene() {
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color3(0.1, 0.1, 0.15);
        
        this.setupCamera();
        this.setupLights();
        this.createEnvironment();
        this.createPlayer();
        this.ui = new UIManager(this);
        this.ui.showWaveIndicator(1);
    }
    
    setupCamera() {
        const camera = new BABYLON.UniversalCamera(
            "camera", 
            new BABYLON.Vector3(0, CONFIG.world.cameraHeight, -CONFIG.world.cameraOffset), 
            this.scene
        );
        camera.setTarget(BABYLON.Vector3.Zero());
        camera.rotation.x = CONFIG.world.cameraAngle;
    }
    
    setupLights() {
        const ambient = new BABYLON.HemisphericLight(
            "ambient", 
            new BABYLON.Vector3(0, 1, 0), 
            this.scene
        );
        ambient.intensity = 0.7;
        
        const dirLight = new BABYLON.DirectionalLight(
            "dir", 
            new BABYLON.Vector3(0.5, -1, 0.5), 
            this.scene
        );
        dirLight.intensity = 0.5;
    }
    
    createEnvironment() {
        // Main ground
        const ground = BABYLON.MeshBuilder.CreateGround(
            "ground", 
            {
                width: CONFIG.world.groundSize, 
                height: CONFIG.world.groundSize, 
                subdivisions: 20
            }, 
            this.scene
        );
        
        const groundMat = new BABYLON.StandardMaterial("groundMat", this.scene);
        groundMat.diffuseColor = new BABYLON.Color3(0.15, 0.25, 0.15);
        groundMat.specularColor = new BABYLON.Color3(0, 0, 0);
        ground.material = groundMat;
        
        // Add grid pattern for visual interest
        for (let i = 0; i < 15; i++) {
            const tile = BABYLON.MeshBuilder.CreateBox(
                "tile", 
                {width: 3, height: 0.01, depth: 3}, 
                this.scene
            );
            tile.position.x = (Math.random() - 0.5) * 50;
            tile.position.z = (Math.random() - 0.5) * 50;
            tile.position.y = 0.01;
            
            const tileMat = new BABYLON.StandardMaterial("tileMat", this.scene);
            tileMat.diffuseColor = new BABYLON.Color3(0.1, 0.2, 0.1);
            tile.material = tileMat;
        }
    }
    
    createPlayer() {
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
            this.createRangeIndicator(player);
        }
        
        this.state.playerMesh = player;
    }

    createRangeIndicator(parent) {
        if (this.state.rangeIndicator) {
            this.state.rangeIndicator.dispose();
        }
        
        const rangeIndicator = BABYLON.MeshBuilder.CreateTorus(
            "rangeIndicator",
            {
                diameter: this.state.player.attackRange * 2, 
                thickness: 0.1, 
                tessellation: 32
            },
            this.scene
        );
        rangeIndicator.position.y = 0.05;
        rangeIndicator.parent = parent;
        
        const rangeMat = new BABYLON.StandardMaterial("rangeMat", this.scene);
        rangeMat.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.8);
        rangeMat.alpha = 0.2;
        rangeIndicator.material = rangeMat;
        
        this.state.rangeIndicator = rangeIndicator;
    }
    
    setupInput() {
        window.addEventListener("keydown", (e) => {
            const key = e.key.toLowerCase();
            
            // Pause on ESC or P
            if (key === 'escape' || key === 'p') {
                this.togglePause();
                return;
            }
            
            this.state.keys[key] = true;
        });
        
        window.addEventListener("keyup", (e) => {
            this.state.keys[e.key.toLowerCase()] = false;
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
    
    createEnemy(type = 'basic') {
        const enemyConfig = CONFIG.enemies.types[type];
        const enemy = BABYLON.MeshBuilder.CreateSphere(
            "enemy", 
            {diameter: enemyConfig.size}, 
            this.scene
        );
        
        // Spawn position
        const angle = Math.random() * Math.PI * 2;
        const distance = CONFIG.enemies.spawnDistance + 
                        Math.random() * CONFIG.enemies.spawnDistanceVariance;
        enemy.position.x = this.state.playerMesh.position.x + Math.cos(angle) * distance;
        enemy.position.z = this.state.playerMesh.position.z + Math.sin(angle) * distance;
        enemy.position.y = enemyConfig.size / 2;
        
        const enemyMat = new BABYLON.StandardMaterial("enemyMat", this.scene);
        enemyMat.diffuseColor = enemyConfig.color;
        enemyMat.emissiveColor = enemyConfig.emissive;
        enemy.material = enemyMat;
        
        enemy.health = enemyConfig.health;
        enemy.maxHealth = enemyConfig.health;
        enemy.speed = enemyConfig.speed + Math.random() * enemyConfig.speedVariance;
        enemy.damage = enemyConfig.damage;
        enemy.type = type;
        enemy.xpValue = enemyConfig.xpValue;
        
        this.state.enemies.push(enemy);
    }
    
    createProjectile(from, to) {
        const projectile = BABYLON.MeshBuilder.CreateSphere(
            "projectile", 
            {diameter: CONFIG.projectiles.basic.size}, 
            this.scene
        );
        
        projectile.position = from.clone();
        projectile.position.y = 0.8;
        
        const projectileMat = new BABYLON.StandardMaterial("projectileMat", this.scene);
        
        // Apply crit chance
        let damage = this.state.player.damage;
        let isCrit = Math.random() < this.state.player.critChance;
        
        if (isCrit) {
            damage *= 2;
            projectileMat.diffuseColor = CONFIG.projectiles.basic.critColor;
            projectileMat.emissiveColor = CONFIG.projectiles.basic.critEmissive;
        } else {
            projectileMat.diffuseColor = CONFIG.projectiles.basic.color;
            projectileMat.emissiveColor = CONFIG.projectiles.basic.emissive;
        }
        
        projectile.material = projectileMat;
        
        const direction = to.subtract(from).normalize();
        projectile.velocity = direction.scale(CONFIG.projectiles.basic.speed);
        projectile.damage = damage;
        projectile.lifetime = CONFIG.projectiles.basic.lifetime;
        projectile.piercing = this.state.player.piercing;
        projectile.hitEnemies = [];
        
        this.state.projectiles.push(projectile);
    }
    
    createPickup(position, type = 'xp', value = null) {
        const pickup = BABYLON.MeshBuilder.CreateSphere(
            "pickup", 
            {diameter: CONFIG.pickups[type].size}, 
            this.scene
        );
        
        pickup.position = position.clone();
        pickup.position.y = 0.5;
        
        const pickupMat = new BABYLON.StandardMaterial("pickupMat", this.scene);
        pickupMat.diffuseColor = CONFIG.pickups[type].color;
        pickupMat.emissiveColor = CONFIG.pickups[type].emissive;
        pickup.material = pickupMat;
        
        pickup.type = type;
        pickup.value = value || CONFIG.pickups[type].value;
        pickup.floatOffset = Math.random() * Math.PI * 2;
        
        this.state.pickups.push(pickup);
    }
    
    findNearestEnemy() {
        let nearest = null;
        let minDist = Infinity;
        
        this.state.enemies.forEach(enemy => {
            const dist = BABYLON.Vector3.Distance(
                this.state.playerMesh.position, 
                enemy.position
            );
            if (dist < minDist && dist <= this.state.player.attackRange) {
                minDist = dist;
                nearest = enemy;
            }
        });
        
        return nearest;
    }
    
    updatePlayer() {
        if (this.state.paused) return;
        
        const moveVector = new BABYLON.Vector3(0, 0, 0);
        
        if (this.state.keys['w'] || this.state.keys['arrowup']) moveVector.z += 1;
        if (this.state.keys['s'] || this.state.keys['arrowdown']) moveVector.z -= 1;
        if (this.state.keys['a'] || this.state.keys['arrowleft']) moveVector.x -= 1;
        if (this.state.keys['d'] || this.state.keys['arrowright']) moveVector.x += 1;
        
        if (moveVector.length() > 0) {
            moveVector.normalize();
            this.state.playerMesh.position.addInPlace(
                moveVector.scale(this.state.player.speed)
            );
            
            // Keep player in bounds
            const maxDist = CONFIG.world.groundSize / 2 - 1;
            this.state.playerMesh.position.x = Math.max(-maxDist, 
                Math.min(maxDist, this.state.playerMesh.position.x));
            this.state.playerMesh.position.z = Math.max(-maxDist, 
                Math.min(maxDist, this.state.playerMesh.position.z));
            
            // Rotate to face movement direction
            if (moveVector.length() > 0.1) {
                const angle = Math.atan2(moveVector.x, moveVector.z);
                this.state.playerMesh.rotation.y = angle;
            }
        }
        
        // Camera follow
        this.scene.activeCamera.position.x = this.state.playerMesh.position.x;
        this.scene.activeCamera.position.z = this.state.playerMesh.position.z - CONFIG.world.cameraOffset;

        // Handle regeneration
        const currentTime = Date.now();
        if (this.state.player.regen > 0 && currentTime - this.state.player.lastRegen > 1000) {
            this.state.player.health = Math.min(
                this.state.player.health + this.state.player.regen,
                this.state.player.maxHealth
            );
            this.state.player.lastRegen = currentTime;
            this.ui.updateHealthBar();
        }

        // Check for range updates
        if (this.state.rangeUpdated) {
            this.createRangeIndicator(this.state.playerMesh);
            this.state.rangeUpdated = false;
        }
    }
    
    updateEnemies() {
        if (this.state.paused) return;
        
        this.state.enemies = this.state.enemies.filter(enemy => {
            // Move towards player
            const direction = this.state.playerMesh.position.subtract(enemy.position);
            direction.y = 0;
            direction.normalize();
            enemy.position.addInPlace(direction.scale(enemy.speed));
            
            // Check collision with player
            const distToPlayer = BABYLON.Vector3.Distance(
                enemy.position, 
                this.state.playerMesh.position
            );
            
            if (distToPlayer < 1) {
                this.state.player.health -= enemy.damage;
                this.ui.updateHealthBar();
                this.createPickup(enemy.position, 'xp', enemy.xpValue);
                enemy.dispose();
                return false;
            }
            
            return true;
        });
    }
    
    updateProjectiles() {
        if (this.state.paused) return;
        
        this.state.projectiles = this.state.projectiles.filter(projectile => {
            projectile.position.addInPlace(projectile.velocity);
            projectile.lifetime--;
            
            // Check collision with enemies
            for (let i = this.state.enemies.length - 1; i >= 0; i--) {
                const enemy = this.state.enemies[i];
                
                // Skip if already hit by this projectile
                if (projectile.hitEnemies && projectile.hitEnemies.includes(enemy)) {
                    continue;
                }
                
                const dist = BABYLON.Vector3.Distance(projectile.position, enemy.position);
                
                if (dist < 0.8) {
                    enemy.health -= projectile.damage;
                    
                    // Track hit enemy for piercing
                    if (!projectile.hitEnemies) projectile.hitEnemies = [];
                    projectile.hitEnemies.push(enemy);
                    
                    if (enemy.health <= 0) {
                        // Life steal on kill
                        if (this.state.player.lifeSteal > 0) {
                            this.state.player.health = Math.min(
                                this.state.player.health + this.state.player.lifeSteal,
                                this.state.player.maxHealth
                            );
                            this.ui.updateHealthBar();
                        }
                        
                        this.createPickup(enemy.position, 'xp', enemy.xpValue);
                        if (Math.random() < CONFIG.pickups.health.dropChance) {
                            this.createPickup(enemy.position, 'health');
                        }
                        enemy.dispose();
                        this.state.enemies.splice(i, 1);
                    }
                    
                    // Destroy projectile if no piercing left
                    if (!projectile.piercing || projectile.hitEnemies.length > projectile.piercing) {
                        projectile.dispose();
                        return false;
                    }
                }
            }
            
            if (projectile.lifetime <= 0) {
                projectile.dispose();
                return false;
            }
            
            return true;
        });
    }
    
    updatePickups() {
        if (this.state.paused) return;
        
        this.state.pickups = this.state.pickups.filter(pickup => {
            // Floating animation
            pickup.position.y = 0.5 + Math.sin(
                Date.now() / CONFIG.pickups.floatSpeed + pickup.floatOffset
            ) * CONFIG.pickups.floatHeight;
            pickup.rotation.y += CONFIG.pickups.rotationSpeed;
            
            const distToPlayer = BABYLON.Vector3.Distance(
                pickup.position, 
                this.state.playerMesh.position
            );
            
            // Magnetic attraction
            if (distToPlayer < this.state.player.magnetRadius) {
                const direction = this.state.playerMesh.position.subtract(pickup.position);
                direction.y = 0;
                direction.normalize();
                const speed = Math.max(0.1, 
                    (this.state.player.magnetRadius - distToPlayer) / 
                    this.state.player.magnetRadius * CONFIG.pickups.magnetSpeed
                );
                pickup.position.addInPlace(direction.scale(speed));
            }
            
            // Collection
            if (distToPlayer < this.state.player.pickupRadius) {
                if (pickup.type === 'xp') {
                    this.handleXPCollection(pickup.value);
                } else if (pickup.type === 'health') {
                    this.handleHealthCollection(pickup.value);
                }
                
                pickup.dispose();
                return false;
            }
            
            return true;
        });
    }
    
    handleXPCollection(value) {
        this.state.player.xp += value;
        
        // Check level up
        while (this.state.player.xp >= this.state.player.xpToNext) {
            this.state.player.xp -= this.state.player.xpToNext;
            this.levelUp();
        }
    }
    
    handleHealthCollection(value) {
        this.state.player.health = Math.min(
            this.state.player.health + value, 
            this.state.player.maxHealth
        );
        this.ui.updateHealthBar();
    }
    
    levelUp() {
        this.state.level++;
        this.state.player.xpToNext = Math.floor(
            this.state.player.xpToNext * CONFIG.progression.xpMultiplier
        );
        
        // Base stat improvements
        this.state.player.damage += CONFIG.player.levelUpDamageBonus;
        this.state.player.attackSpeed = Math.max(
            CONFIG.player.minAttackSpeed,
            this.state.player.attackSpeed - CONFIG.player.attackSpeedReduction
        );
        this.state.player.maxHealth += CONFIG.player.levelUpHealthBonus;
        this.state.player.health = Math.min(
            this.state.player.health + CONFIG.player.levelUpHeal, 
            this.state.player.maxHealth
        );
        
        // Offer upgrade selection
        this.state.upgradesPending++;
        this.togglePause();
        
        this.ui.updateHealthBar();
        this.ui.animateLevelUp();
    }
    
    updateWaveSystem(currentTime) {
        if (this.state.paused) return;
        
        const waveConfig = CONFIG.waves[this.state.currentWave] || CONFIG.waves[8];
        const waveElapsed = currentTime - this.state.waveStartTime;
        
        // Check wave completion
        if (waveElapsed > waveConfig.duration) {
            this.state.currentWave++;
            this.state.waveStartTime = currentTime;
            this.ui.showWaveIndicator(this.state.currentWave);
            this.ui.updateStats();
        }
        
        // Spawn enemies based on wave config
        if (currentTime - this.state.lastEnemySpawn > waveConfig.spawnRate) {
            let enemyType;
            
            if (waveConfig.enemies[0] === 'all') {
                const types = Object.keys(CONFIG.enemies.types);
                enemyType = types[Math.floor(Math.random() * types.length)];
            } else {
                enemyType = waveConfig.enemies[Math.floor(Math.random() * waveConfig.enemies.length)];
            }
            
            this.createEnemy(enemyType);
            this.state.lastEnemySpawn = currentTime;
        }
    }
    
    autoAttack(currentTime) {
        if (this.state.paused) return;
        
        // Update cooldown bar
        const cooldownProgress = Math.min(1, 
            (currentTime - this.state.player.lastAttack) / this.state.player.attackSpeed
        );
        this.ui.updateCooldownBar(cooldownProgress);
        
        if (currentTime - this.state.player.lastAttack > this.state.player.attackSpeed) {
            const target = this.findNearestEnemy();
            if (target) {
                this.createProjectile(this.state.playerMesh.position, target.position);
                this.state.player.lastAttack = currentTime;
            }
        }
    }
    
    checkGameOver() {
        if (this.state.player.health <= 0) {
            const survivalTime = this.formatTime(Date.now() - this.state.startTime);
            alert(`Game Over!\nSurvived: ${survivalTime}\nWave: ${this.state.currentWave}\nLevel: ${this.state.level}`);
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
            
            this.updatePlayer();
            this.updateWaveSystem(currentTime);
            this.autoAttack(currentTime);
            this.updateEnemies();
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