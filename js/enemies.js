// Base Enemy Class
class Enemy {
    constructor(name, config, scene, type = null) {
        this.name = name;
        this.type = type || name.toLowerCase(); // Type for item drops
        this.health = config.health;
        this.maxHealth = config.health;
        this.speed = config.speed;
        this.damage = config.damage;
        this.size = config.size;
        this.xpValue = config.xpValue;
        this.color = config.color;
        this.emissive = config.emissive;
        this.scene = scene;
        this.mesh = null;
        this.lastAction = 0;
        this.actionCooldown = config.actionCooldown || 1000;

        this.createMesh();
    }
    
    createMesh() {
        this.mesh = BABYLON.MeshBuilder.CreateSphere(
            `enemy_${this.name}`, 
            {diameter: this.size}, 
            this.scene
        );
        
        const material = new BABYLON.StandardMaterial(`${this.name}Mat`, this.scene);
        material.diffuseColor = this.color;
        material.emissiveColor = this.emissive;
        this.mesh.material = material;
        
        // Store reference to this enemy in the mesh
        this.mesh.enemyRef = this;
    }
    
    update(game, currentTime) {
        this.move(game);
        this.performAction(game, currentTime);
    }
    
    move(game) {
        // Basic movement towards player
        const direction = game.player.mesh.position.subtract(this.mesh.position);
        direction.y = 0;
        direction.normalize();
        this.mesh.position.addInPlace(direction.scale(this.speed));
    }
    
    performAction(game, currentTime) {
        // Override in subclasses for special abilities
    }
    
    takeDamage(amount) {
        this.health -= amount;
        this.onDamaged();
        return this.health <= 0;
    }
    
    onDamaged() {
        // Visual feedback when damaged
        if (this.mesh && this.mesh.material) {
            const originalColor = this.mesh.material.emissiveColor.clone();
            this.mesh.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
            setTimeout(() => {
                if (this.mesh && this.mesh.material) {
                    this.mesh.material.emissiveColor = originalColor;
                }
            }, 100);
        }
    }
    
    destroy() {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
    }
    
    getPosition() {
        return this.mesh ? this.mesh.position : null;
    }
}

// Basic Enemy - Standard behavior
class BasicEnemy extends Enemy {
    constructor(scene) {
        super('Basic', {
            health: 30,
            speed: 0.03,
            damage: 5,
            size: 0.8,
            xpValue: 1,
            color: new BABYLON.Color3(1, 0.2, 0.2),
            emissive: new BABYLON.Color3(0.5, 0.1, 0.1)
        }, scene);
    }
}

// Fast Enemy - Quick but fragile
class FastEnemy extends Enemy {
    constructor(scene) {
        super('Fast', {
            health: 15,
            speed: 0.06,
            damage: 3,
            size: 0.6,
            xpValue: 2,
            color: new BABYLON.Color3(0.2, 1, 0.2),
            emissive: new BABYLON.Color3(0.1, 0.5, 0.1)
        }, scene);
    }
    
    move(game) {
        // Slightly erratic movement
        const baseDirection = game.player.mesh.position.subtract(this.mesh.position);
        baseDirection.y = 0;
        baseDirection.normalize();

        // Add some randomness
        const randomOffset = new BABYLON.Vector3(
            (Math.random() - 0.5) * 0.1,
            0,
            (Math.random() - 0.5) * 0.1
        );

        baseDirection.addInPlace(randomOffset);
        baseDirection.normalize();

        this.mesh.position.addInPlace(baseDirection.scale(this.speed));
    }
}

// Tank Enemy - Slow but tough
class TankEnemy extends Enemy {
    constructor(scene) {
        super('Tank', {
            health: 80,
            speed: 0.015,
            damage: 12,
            size: 1.2,
            xpValue: 5,
            color: new BABYLON.Color3(0.6, 0.6, 0.6),
            emissive: new BABYLON.Color3(0.3, 0.3, 0.3)
        }, scene);
    }
    
    onDamaged() {
        super.onDamaged();
        // Tanks get slightly faster when damaged
        if (this.health < this.maxHealth * 0.5) {
            this.speed = Math.min(0.025, this.speed + 0.001);
        }
    }
}

// Swarm Enemy - Weak but numerous
class SwarmEnemy extends Enemy {
    constructor(scene) {
        super('Swarm', {
            health: 10,
            speed: 0.06,
            damage: 2,
            size: 0.4,
            xpValue: 1,
            color: new BABYLON.Color3(0.2, 1, 0.2),
            emissive: new BABYLON.Color3(0.1, 0.5, 0.1)
        }, scene);
    }
}

// Explosive Enemy - Explodes on death
class ExplosiveEnemy extends Enemy {
    constructor(scene) {
        super('Explosive', {
            health: 20,
            speed: 0.04,
            damage: 8,
            size: 0.7,
            xpValue: 3,
            color: new BABYLON.Color3(1, 0.5, 0),
            emissive: new BABYLON.Color3(0.8, 0.3, 0),
            actionCooldown: 500
        }, scene);
        this.explosionRadius = 3;
        this.explosionDamage = 15;
    }
    
    createMesh() {
        super.createMesh();
        // Add pulsing effect
        this.pulseAnimation();
    }
    
    pulseAnimation() {
        if (!this.mesh) return;
        
        const animationGroup = new BABYLON.AnimationGroup('explosivePulse', this.scene);
        const scaleAnimation = new BABYLON.Animation(
            'scaleAnimation',
            'scaling',
            30,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        const keys = [];
        keys.push({frame: 0, value: new BABYLON.Vector3(1, 1, 1)});
        keys.push({frame: 15, value: new BABYLON.Vector3(1.2, 1.2, 1.2)});
        keys.push({frame: 30, value: new BABYLON.Vector3(1, 1, 1)});
        
        scaleAnimation.setKeys(keys);
        animationGroup.addTargetedAnimation(scaleAnimation, this.mesh);
        animationGroup.play(true);
        
        this.animationGroup = animationGroup;
    }
    
    takeDamage(amount) {
        const isDead = super.takeDamage(amount);
        if (isDead) {
            this.explode();
        }
        return isDead;
    }
    
    explode() {
        // Create explosion effect (visual placeholder)
        if (this.mesh) {
            const explosion = BABYLON.MeshBuilder.CreateSphere(
                'explosion',
                {diameter: this.explosionRadius * 2},
                this.scene
            );
            explosion.position = this.mesh.position.clone();
            
            const explosionMat = new BABYLON.StandardMaterial('explosionMat', this.scene);
            explosionMat.diffuseColor = new BABYLON.Color3(1, 0.5, 0);
            explosionMat.emissiveColor = new BABYLON.Color3(1, 0.8, 0);
            explosionMat.alpha = 0.5;
            explosion.material = explosionMat;
            
            // Animate explosion
            const scaleAnim = BABYLON.Animation.CreateAndStartAnimation(
                'explosionScale',
                explosion,
                'scaling',
                30,
                15,
                new BABYLON.Vector3(0.1, 0.1, 0.1),
                new BABYLON.Vector3(1, 1, 1),
                BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
            );
            
            const alphaAnim = BABYLON.Animation.CreateAndStartAnimation(
                'explosionAlpha',
                explosion.material,
                'alpha',
                30,
                15,
                0.5,
                0,
                BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
            );
            
            setTimeout(() => {
                explosion.dispose();
            }, 500);
        }
        
        // Return explosion data for game logic
        return {
            position: this.mesh.position.clone(),
            radius: this.explosionRadius,
            damage: this.explosionDamage
        };
    }
    
    destroy() {
        if (this.animationGroup) {
            this.animationGroup.dispose();
        }
        super.destroy();
    }
}

// Ranged Enemy - Shoots projectiles
class RangedEnemy extends Enemy {
    constructor(scene) {
        super('Ranged', {
            health: 25,
            speed: 0.02,
            damage: 4,
            size: 0.9,
            xpValue: 4,
            color: new BABYLON.Color3(0.5, 0.2, 1),
            emissive: new BABYLON.Color3(0.25, 0.1, 0.5),
            actionCooldown: 2000
        }, scene);
        this.attackRange = 8;
        this.projectileSpeed = 0.3;
    }
    
    performAction(game, currentTime) {
        if (currentTime - this.lastAction < this.actionCooldown) return;
        
        const distToPlayer = BABYLON.Vector3.Distance(
            this.mesh.position,
            game.player.mesh.position
        );

        if (distToPlayer <= this.attackRange) {
            this.shootAtPlayer(game);
            this.lastAction = currentTime;
        }
    }
    
    shootAtPlayer(game) {
        const projectile = BABYLON.MeshBuilder.CreateSphere(
            'enemyProjectile',
            {diameter: 0.2},
            this.scene
        );

        projectile.position = this.mesh.position.clone();
        projectile.position.y = 0.8;

        const projectileMat = new BABYLON.StandardMaterial('enemyProjectileMat', this.scene);
        projectileMat.diffuseColor = new BABYLON.Color3(1, 0, 1);
        projectileMat.emissiveColor = new BABYLON.Color3(0.5, 0, 0.5);
        projectile.material = projectileMat;

        const direction = game.player.mesh.position.subtract(projectile.position);
        direction.y = 0;
        direction.normalize();

        projectile.velocity = direction.scale(this.projectileSpeed);
        projectile.damage = this.damage;
        projectile.lifetime = 120;
        projectile.isEnemyProjectile = true;

        game.projectileManager.addEnemyProjectile(projectile);
    }
    
    move(game) {
        const distToPlayer = BABYLON.Vector3.Distance(
            this.mesh.position,
            game.player.mesh.position
        );

        // Keep optimal distance - not too close, not too far
        const optimalDistance = 6;

        if (distToPlayer < optimalDistance - 1) {
            // Move away
            const direction = this.mesh.position.subtract(game.player.mesh.position);
            direction.y = 0;
            direction.normalize();
            this.mesh.position.addInPlace(direction.scale(this.speed));
        } else if (distToPlayer > optimalDistance + 1) {
            // Move closer
            const direction = game.player.mesh.position.subtract(this.mesh.position);
            direction.y = 0;
            direction.normalize();
            this.mesh.position.addInPlace(direction.scale(this.speed));
        }
        // Else maintain position
    }
}

// Boss Enemy - Large, tough, multiple abilities
class BossEnemy extends Enemy {
    constructor(scene) {
        super('Boss', {
            health: 200,
            speed: 0.01,
            damage: 20,
            size: 2.0,
            xpValue: 25,
            color: new BABYLON.Color3(0.8, 0, 0.8),
            emissive: new BABYLON.Color3(0.4, 0, 0.4),
            actionCooldown: 3000
        }, scene);
        this.phase = 1;
        this.abilities = ['charge', 'summon', 'barrage'];
        this.lastAbility = 0;
    }
    
    createMesh() {
        super.createMesh();
        // Add intimidating features
        const crown = BABYLON.MeshBuilder.CreateBox(
            'bossCrown',
            {width: 0.5, height: 0.3, depth: 0.5},
            this.scene
        );
        crown.position.y = this.size;
        crown.parent = this.mesh;
        
        const crownMat = new BABYLON.StandardMaterial('crownMat', this.scene);
        crownMat.diffuseColor = new BABYLON.Color3(1, 1, 0);
        crownMat.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0);
        crown.material = crownMat;
    }
    
    performAction(game, currentTime) {
        if (currentTime - this.lastAction < this.actionCooldown) return;
        
        // Check phase transition
        const healthPercent = this.health / this.maxHealth;
        if (healthPercent < 0.5 && this.phase === 1) {
            this.phase = 2;
            this.actionCooldown = 2000; // Faster abilities
            this.speed *= 1.5; // Faster movement
        }
        
        // Use random ability
        const ability = this.abilities[Math.floor(Math.random() * this.abilities.length)];
        this.useAbility(ability, game);
        this.lastAction = currentTime;
    }
    
    useAbility(ability, game) {
        switch (ability) {
            case 'charge':
                this.chargeAttack(game);
                break;
            case 'summon':
                this.summonMinions(game);
                break;
            case 'barrage':
                this.projectileBarrage(game);
                break;
        }
    }
    
    chargeAttack(game) {
        // Temporary speed boost towards player
        const direction = game.player.mesh.position.subtract(this.mesh.position);
        direction.y = 0;
        direction.normalize();

        const chargeSpeed = 0.1;
        const chargeDuration = 1000;

        const startTime = Date.now();
        const chargeInterval = setInterval(() => {
            if (Date.now() - startTime > chargeDuration || !this.mesh) {
                clearInterval(chargeInterval);
                return;
            }
            this.mesh.position.addInPlace(direction.scale(chargeSpeed));
        }, 16);
    }
    
    summonMinions(game) {
        // Spawn basic enemies around the boss
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const distance = 3;
            
            const minion = new BasicEnemy(this.scene);
            minion.mesh.position.x = this.mesh.position.x + Math.cos(angle) * distance;
            minion.mesh.position.z = this.mesh.position.z + Math.sin(angle) * distance;
            minion.mesh.position.y = 0.4;
            
            game.state.enemies.push(minion);
        }
    }
    
    projectileBarrage(game) {
        // Fire projectiles in all directions
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const direction = new BABYLON.Vector3(Math.cos(angle), 0, Math.sin(angle));
            
            setTimeout(() => {
                if (!this.mesh) return;
                
                const projectile = BABYLON.MeshBuilder.CreateSphere(
                    'bossProjectile',
                    {diameter: 0.3},
                    this.scene
                );
                
                projectile.position = this.mesh.position.clone();
                projectile.position.y = 1;
                
                const projectileMat = new BABYLON.StandardMaterial('bossProjectileMat', this.scene);
                projectileMat.diffuseColor = new BABYLON.Color3(0.8, 0, 0.8);
                projectileMat.emissiveColor = new BABYLON.Color3(0.4, 0, 0.4);
                projectile.material = projectileMat;
                
                projectile.velocity = direction.scale(0.2);
                projectile.damage = this.damage * 0.5;
                projectile.lifetime = 150;
                projectile.isEnemyProjectile = true;

                game.projectileManager.addEnemyProjectile(projectile);
            }, i * 100);
        }
    }
}

// Enemy Factory
class EnemyFactory {
    static createEnemy(type, scene) {
        switch (type) {
            case 'basic':
                return new BasicEnemy(scene);
            case 'fast':
                return new FastEnemy(scene);
            case 'tank':
                return new TankEnemy(scene);
            case 'swarm':
                return new SwarmEnemy(scene);
            case 'explosive':
                return new ExplosiveEnemy(scene);
            case 'ranged':
                return new RangedEnemy(scene);
            case 'boss':
                return new BossEnemy(scene);
            default:
                return new BasicEnemy(scene);
        }
    }
    
    static getRandomEnemyType(waveNumber) {
        const types = ['basic', 'fast'];

        // Unlock enemy types based on wave/time
        if (waveNumber > 3) types.push('swarm');
        if (waveNumber > 5) types.push('tank');
        if (waveNumber > 10) types.push('explosive');
        if (waveNumber > 15) types.push('ranged');

        return types[Math.floor(Math.random() * types.length)];
    }
    
    static shouldSpawnBoss(waveNumber) {
        // Spawn boss every 20 waves
        return waveNumber > 0 && waveNumber % 20 === 0;
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Enemy,
        BasicEnemy,
        FastEnemy,
        TankEnemy,
        SwarmEnemy,
        ExplosiveEnemy,
        RangedEnemy,
        BossEnemy,
        EnemyFactory
    };
}