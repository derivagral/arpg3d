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
                magnetRadius: CONFIG.player.magnetRadius
            },
            enemies: [],
            projectiles: [],
            pickups: [],
            startTime: Date.now(),
            level: 1,
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
        const enemy = BABYLON.MeshBuilder.CreateSphere(
            "enemy", 
            {diameter: CONFIG.enemies.basic.size}, 
            this.scene
        );
        
        // Spawn position
        const angle = Math.random() * Math.PI * 2;
        const distance = CONFIG.enemies.spawnDistance + 
                        Math.random() * CONFIG.enemies.spawnDistanceVariance;
        enemy.position.x = this.state.playerMesh.position.x + Math.cos(angle) * distance;
        enemy.position.z = this.state.playerMesh.position.z + Math.sin(angle) * distance;
        enemy.position.y = 0.4;
        
        const enemyMat = new BABYLON.StandardMaterial("enemyMat", this.scene);
        enemyMat.diffuseColor = CONFIG.enemies.basic.color;
        enemyMat.emissiveColor = CONFIG.enemies.basic.emissive;
        enemy.material = enemyMat;
        
        enemy.health = CONFIG.enemies.basic.health;
        enemy.speed = CONFIG.enemies.basic.speed + 
                     Math.random() * CONFIG.enemies.basic.speedVariance;
        enemy.damage = CONFIG.enemies.basic.damage;
        
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
        projectileMat.diffuseColor = CONFIG.projectiles.basic.color;
        projectileMat.emissiveColor = CONFIG.projectiles.basic.emissive;
        projectile.material = projectileMat;
        
        const direction = to.subtract(from).normalize();
        projectile.velocity = direction.scale(CONFIG.projectiles.basic.speed);
        projectile.damage = this.state.player.damage;
        projectile.lifetime = CONFIG.projectiles.basic.lifetime;
        
        this.state.projectiles.push(projectile);
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
                this.updateHealthBar();
                this.createPickup(enemy.position, 'xp');
                enemy.dispose();
                return false;
            }
            
            return true;
        });
    }
    
    updateProjectiles() {
        this.state.projectiles = this.state.projectiles.filter(projectile => {
            projectile.position.addInPlace(projectile.velocity);
            projectile.lifetime--;
            
            // Check collision with enemies
            for (let i = this.state.enemies.length - 1; i >= 0; i--) {
                const enemy = this.state.enemies[i];
                const dist = BABYLON.Vector3.Distance(projectile.position, enemy.position);
                
                if (dist < 0.8) {
                    enemy.health -= projectile.damage;
                    
                    if (enemy.health <= 0) {
                        this.createPickup(enemy.position, 'xp');
                        if (Math.random() < CONFIG.pickups.health.dropChance) {
                            this.createPickup(enemy.position, 'health');
                        }
                        enemy.dispose();
                        this.state.enemies.splice(i, 1);
                    }
                    
                    projectile.dispose();
                    return false;
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
            }
        }
    }
    
    autoAttack(currentTime) {
        if (currentTime - this.state.player.lastAttack > this.state.player.attackSpeed) {
            const target = this.findNearestEnemy();
            if (target) {
                this.createProjectile(this.state.playerMesh.position, target.position);
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
