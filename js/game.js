// Game Class
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
                weapon: WeaponFactory.createWeapon('basic')
            },
            enemies: [],
            projectiles: [],
            enemyProjectiles: [],
            pickups: [],
            startTime: Date.now(),
            level: 1,
            waveNumber: 1,
            enemySpawnRate: CONFIG.enemies.spawnRate,
            lastEnemySpawn: 0,
            keys: {},
            playerMesh: null
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
    }
    
    setupCamera() {
        const camera = new BABYLON.UniversalCamera(
            "camera", 
            new BABYLON.Vector3(0, CONFIG.world.cameraHeight, -CONFIG.world.cameraOffset), 
            this.scene
        );
        camera.setTarget(BABYLON.Vector3.Zero());
        camera.rotation.x = CONFIG.world.cameraAngle;
        camera.fov = 1.2; // Wider field of view for better visibility
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
        
        // Add visual variety
        for (let i = 0; i < 10; i++) {
            const tile = BABYLON.MeshBuilder.CreateBox(
                "tile", 
                {width: 2, height: 0.01, depth: 2}, 
                this.scene
            );
            tile.position.x = (Math.random() - 0.5) * 40;
            tile.position.z = (Math.random() - 0.5) * 40;
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
        
        this.state.playerMesh = player;
    }
    
    setupInput() {
        window.addEventListener("keydown", (e) => {
            this.state.keys[e.key.toLowerCase()] = true;
        });
        
        window.addEventListener("keyup", (e) => {
            this.state.keys[e.key.toLowerCase()] = false;
        });
    }
    
    createEnemy() {
        const enemyType = EnemyFactory.getRandomEnemyType(this.state.waveNumber);
        const enemy = EnemyFactory.createEnemy(enemyType, this.scene);
        
        // Spawn position
        const angle = Math.random() * Math.PI * 2;
        const distance = CONFIG.enemies.spawnDistance + 
                        Math.random() * CONFIG.enemies.spawnDistanceVariance;
        enemy.mesh.position.x = this.state.playerMesh.position.x + Math.cos(angle) * distance;
        enemy.mesh.position.z = this.state.playerMesh.position.z + Math.sin(angle) * distance;
        enemy.mesh.position.y = 0.4;
        
        this.state.enemies.push(enemy);
        
        // Check for boss spawn
        if (EnemyFactory.shouldSpawnBoss(this.state.waveNumber)) {
            const boss = EnemyFactory.createEnemy('boss', this.scene);
            boss.mesh.position.x = this.state.playerMesh.position.x + Math.cos(angle + Math.PI) * (distance + 5);
            boss.mesh.position.z = this.state.playerMesh.position.z + Math.sin(angle + Math.PI) * (distance + 5);
            boss.mesh.position.y = 1;
            this.state.enemies.push(boss);
        }
    }
    
    createProjectile(from, to, weapon) {
        const projectile = BABYLON.MeshBuilder.CreateSphere(
            "projectile", 
            {diameter: weapon.projectileConfig.size || CONFIG.projectiles.basic.size}, 
            this.scene
        );
        
        projectile.position = from.clone();
        projectile.position.y = 0.8;
        
        const projectileMat = new BABYLON.StandardMaterial("projectileMat", this.scene);
        projectileMat.diffuseColor = weapon.projectileConfig.color || CONFIG.projectiles.basic.color;
        projectileMat.emissiveColor = weapon.projectileConfig.emissive || CONFIG.projectiles.basic.emissive;
        projectile.material = projectileMat;
        
        const direction = to.subtract(from).normalize();
        projectile.velocity = direction.scale(weapon.projectileConfig.speed || CONFIG.projectiles.basic.speed);
        projectile.damage = weapon.damage;
        projectile.lifetime = weapon.projectileConfig.lifetime || CONFIG.projectiles.basic.lifetime;
        projectile.weaponRef = weapon;
        
        this.state.projectiles.push(projectile);
    }
    
    createExplosiveProjectile(from, to, weapon) {
        this.createProjectile(from, to, weapon);
        // The last projectile is the explosive one
        const projectile = this.state.projectiles[this.state.projectiles.length - 1];
        projectile.isExplosive = true;
        projectile.explosionRadius = weapon.explosionRadius;
    }
    
    createPickup(position, type = 'xp') {
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
        pickup.value = CONFIG.pickups[type].value;
        pickup.floatOffset = Math.random() * Math.PI * 2;
        
        this.state.pickups.push(pickup);
    }
    
    findNearestEnemy() {
        let nearest = null;
        let minDist = Infinity;
        
        this.state.enemies.forEach(enemy => {
            const dist = BABYLON.Vector3.Distance(
                this.state.playerMesh.position, 
                enemy.getPosition()
            );
            if (dist < minDist && dist <= this.state.player.attackRange) {
                minDist = dist;
                nearest = enemy;
            }
        });
        
        return nearest;
    }
    
    updatePlayer() {
        const moveVector = new BABYLON.Vector3(0, 0, 0);
        
        if (this.state.keys['w'] || this.state.keys['arrowup']) moveVector.z += 1;
        if (this.state.keys['s'] || this.state.keys['arrowdown']) moveVector.z -= 1;
        if (this.state.keys['a'] || this.state.keys['arrowleft']) moveVector.x -= 1;
        if (this.state.keys['d'] || this.state.keys['arrowright']) moveVector.x += 1;
        
        if (moveVector.length() > 0) {
            moveVector.normalize();
            const newPosition = this.state.playerMesh.position.add(
                moveVector.scale(this.state.player.speed)
            );
            
            // Enforce boundary constraints
            const boundary = CONFIG.world.groundSize / 2 - 1; // Leave 1 unit buffer
            newPosition.x = Math.max(-boundary, Math.min(boundary, newPosition.x));
            newPosition.z = Math.max(-boundary, Math.min(boundary, newPosition.z));
            
            this.state.playerMesh.position = newPosition;
            
            // Rotate to face movement direction
            if (moveVector.length() > 0.1) {
                const angle = Math.atan2(moveVector.x, moveVector.z);
                this.state.playerMesh.rotation.y = angle;
            }
        }
        
        // Camera follow
        this.scene.activeCamera.position.x = this.state.playerMesh.position.x;
        this.scene.activeCamera.position.z = this.state.playerMesh.position.z - CONFIG.world.cameraOffset;
    }
    
    updateEnemies() {
        const currentTime = Date.now();
        
        this.state.enemies = this.state.enemies.filter(enemy => {
            // Update enemy AI
            enemy.update(this, currentTime);
            
            // Check collision with player
            const distToPlayer = BABYLON.Vector3.Distance(
                enemy.getPosition(), 
                this.state.playerMesh.position
            );
            
            if (distToPlayer < 1) {
                this.state.player.health -= enemy.damage;
                this.updateHealthBar();
                
                // Create XP pickup
                this.createPickup(enemy.getPosition(), 'xp');
                for (let i = 0; i < enemy.xpValue; i++) {
                    this.createPickup(enemy.getPosition(), 'xp');
                }
                
                // Handle explosive enemies
                if (enemy instanceof ExplosiveEnemy) {
                    const explosion = enemy.explode();
                    if (explosion) {
                        this.handleExplosion(explosion);
                    }
                }
                
                enemy.destroy();
                return false;
            }
            
            return true;
        });
    }
    
    handleExplosion(explosion) {
        // Damage player if in range
        const distToPlayer = BABYLON.Vector3.Distance(
            explosion.position,
            this.state.playerMesh.position
        );
        
        if (distToPlayer <= explosion.radius) {
            this.state.player.health -= explosion.damage;
            this.updateHealthBar();
        }
        
        // Damage other enemies
        this.state.enemies.forEach(enemy => {
            const distToEnemy = BABYLON.Vector3.Distance(
                explosion.position,
                enemy.getPosition()
            );
            
            if (distToEnemy <= explosion.radius) {
                const isDead = enemy.takeDamage(explosion.damage);
                if (isDead) {
                    this.createPickup(enemy.getPosition(), 'xp');
                    for (let i = 0; i < enemy.xpValue; i++) {
                        this.createPickup(enemy.getPosition(), 'xp');
                    }
                    enemy.destroy();
                }
            }
        });
    }
    
    updateProjectiles() {
        // Update player projectiles
        this.state.projectiles = this.state.projectiles.filter(projectile => {
            projectile.position.addInPlace(projectile.velocity);
            projectile.lifetime--;
            
            // Check collision with enemies
            for (let i = this.state.enemies.length - 1; i >= 0; i--) {
                const enemy = this.state.enemies[i];
                const dist = BABYLON.Vector3.Distance(projectile.position, enemy.getPosition());
                
                if (dist < 0.8) {
                    const isDead = enemy.takeDamage(projectile.damage);
                    
                    if (isDead) {
                        // Create XP pickups
                        for (let j = 0; j < enemy.xpValue; j++) {
                            this.createPickup(enemy.getPosition(), 'xp');
                        }
                        
                        // Health drop chance
                        if (Math.random() < CONFIG.pickups.health.dropChance) {
                            this.createPickup(enemy.getPosition(), 'health');
                        }
                        
                        // Handle explosive enemies
                        if (enemy instanceof ExplosiveEnemy) {
                            const explosion = enemy.explode();
                            if (explosion) {
                                this.handleExplosion(explosion);
                            }
                        }
                        
                        enemy.destroy();
                        this.state.enemies.splice(i, 1);
                    }
                    
                    // Handle explosive projectiles
                    if (projectile.isExplosive) {
                        this.createProjectileExplosion(projectile);
                    }
                    
                    projectile.dispose();
                    return false;
                }
            }
            
            // Handle explosive projectiles at end of lifetime
            if (projectile.lifetime <= 0) {
                if (projectile.isExplosive) {
                    this.createProjectileExplosion(projectile);
                }
                projectile.dispose();
                return false;
            }
            
            return true;
        });
        
        // Update enemy projectiles
        this.updateEnemyProjectiles();
    }
    
    createProjectileExplosion(projectile) {
        const explosion = {
            position: projectile.position.clone(),
            radius: projectile.explosionRadius,
            damage: projectile.damage
        };
        this.handleExplosion(explosion);
    }
    
    updateEnemyProjectiles() {
        if (!this.state.enemyProjectiles) return;
        
        this.state.enemyProjectiles = this.state.enemyProjectiles.filter(projectile => {
            projectile.position.addInPlace(projectile.velocity);
            projectile.lifetime--;
            
            // Check collision with player
            const distToPlayer = BABYLON.Vector3.Distance(
                projectile.position, 
                this.state.playerMesh.position
            );
            
            if (distToPlayer < 0.8) {
                this.state.player.health -= projectile.damage;
                this.updateHealthBar();
                projectile.dispose();
                return false;
            }
            
            if (projectile.lifetime <= 0) {
                projectile.dispose();
                return false;
            }
            
            return true;
        });
    }
    
    updatePickups() {
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
        this.updateHealthBar();
    }
    
    levelUp() {
        this.state.level++;
        this.state.player.xpToNext = Math.floor(
            this.state.player.xpToNext * CONFIG.progression.xpMultiplier
        );
        
        // Apply bonuses
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
        
        // Upgrade weapon
        this.state.player.weapon.upgrade();
        
        this.updateHealthBar();
        
        // Add level up animation
        const levelElement = document.getElementById('level');
        levelElement.classList.add('level-up-animation');
        setTimeout(() => {
            levelElement.classList.remove('level-up-animation');
        }, 500);
    }
    
    spawnEnemies(currentTime) {
        if (currentTime - this.state.lastEnemySpawn > this.state.enemySpawnRate) {
            this.createEnemy();
            this.state.lastEnemySpawn = currentTime;
            
            // Increase difficulty
            if (this.state.enemies.length > CONFIG.enemies.maxEnemiesBeforeDifficultyIncrease) {
                this.state.enemySpawnRate = Math.max(
                    CONFIG.enemies.minSpawnRate,
                    this.state.enemySpawnRate - CONFIG.enemies.spawnRateReduction
                );
                
                // Increment wave number for enemy variety
                if (this.state.enemySpawnRate <= CONFIG.enemies.minSpawnRate) {
                    this.state.waveNumber++;
                }
            }
        }
    }
    
    autoAttack(currentTime) {
        const weapon = this.state.player.weapon;
        
        if (weapon.canAttack(currentTime, this.state.player.lastAttack)) {
            const attacked = weapon.attack(this, this.state.playerMesh.position, this.state.enemies);
            if (attacked) {
                this.state.player.lastAttack = currentTime;
            }
        }
    }
    
    updateHealthBar() {
        const percentage = Math.max(0, 
            this.state.player.health / this.state.player.maxHealth * 100
        );
        document.getElementById('healthFill').style.width = percentage + '%';
    }
    
    updateWeaponCooldown() {
        const currentTime = Date.now();
        const timeSinceLastAttack = currentTime - this.state.player.lastAttack;
        const cooldownProgress = Math.min(1, timeSinceLastAttack / this.state.player.weapon.attackSpeed);
        const percentage = cooldownProgress * 100;
        
        const cooldownFill = document.getElementById('weaponCooldownFill');
        if (cooldownFill) {
            cooldownFill.style.width = percentage + '%';
        }
    }
    
    updateStats() {
        document.getElementById('enemyCount').textContent = 
            `Enemies: ${this.state.enemies.length}`;
        
        const elapsed = Date.now() - this.state.startTime;
        document.getElementById('timer').textContent = 
            `Time: ${this.formatTime(elapsed)}`;
        
        document.getElementById('level').textContent = 
            `Level: ${this.state.level}`;
        
        document.getElementById('xp').textContent = 
            `XP: ${this.state.player.xp} / ${this.state.player.xpToNext}`;
            
        // Update weapon display
        const weaponElement = document.getElementById('weaponInfo');
        if (weaponElement) {
            const weapon = this.state.player.weapon;
            weaponElement.textContent = `${weapon.name} Lv.${weapon.level}`;
        }
    }
    
    formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
    
    checkGameOver() {
        if (this.state.player.health <= 0) {
            const survivalTime = this.formatTime(Date.now() - this.state.startTime);
            alert(`Game Over!\nSurvived: ${survivalTime}\nLevel: ${this.state.level}`);
            location.reload();
        }
    }
    
    startGameLoop() {
        this.scene.registerBeforeRender(() => {
            const currentTime = Date.now();
            
            this.updatePlayer();
            this.spawnEnemies(currentTime);
            this.autoAttack(currentTime);
            this.updateEnemies();
            this.updateProjectiles();
            this.updatePickups();
            this.updateStats();
            this.updateWeaponCooldown();
            this.checkGameOver();
        });
    }
    
    start() {
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });
        
        window.addEventListener("resize", () => {
            this.engine.resize();
        });
    }
}