// Base Weapon Class
class Weapon {
    constructor(name, config) {
        this.name = name;
        this.damage = config.damage;
        this.attackSpeed = config.attackSpeed;
        this.range = config.range;
        this.projectileConfig = config.projectile || {};
        this.level = 1;
        this.maxLevel = config.maxLevel || 5;
        this.description = config.description || '';
    }
    
    attack(game, from, targets) {
        // Override in subclasses
        throw new Error('Attack method must be implemented by weapon subclass');
    }
    
    upgrade() {
        if (this.level < this.maxLevel) {
            this.level++;
            this.applyUpgrade();
        }
    }
    
    applyUpgrade() {
        // Default upgrade behavior - increase damage
        this.damage = Math.floor(this.damage * 1.2);
    }
    
    canAttack(currentTime, lastAttack) {
        return currentTime - lastAttack >= this.attackSpeed;
    }
}

// Basic Projectile Weapon
class BasicBlaster extends Weapon {
    constructor() {
        super('Basic Blaster', {
            damage: 10,
            attackSpeed: 1000,
            range: 8,
            maxLevel: 8,
            description: 'Fires single projectiles at the nearest enemy',
            projectile: {
                speed: 0.5,
                size: 0.3,
                lifetime: 60,
                color: new BABYLON.Color3(1, 1, 0),
                emissive: new BABYLON.Color3(1, 0.8, 0)
            }
        });
    }
    
    attack(game, from, targets) {
        const target = this.findNearestTarget(game, targets);
        if (target) {
            game.createProjectile(from, target.position, this);
            return true;
        }
        return false;
    }
    
    findNearestTarget(game, targets) {
        let nearest = null;
        let minDist = Infinity;
        
        targets.forEach(target => {
            const dist = BABYLON.Vector3.Distance(
                game.state.playerMesh.position, 
                target.position
            );
            if (dist < minDist && dist <= this.range) {
                minDist = dist;
                nearest = target;
            }
        });
        
        return nearest;
    }
    
    applyUpgrade() {
        super.applyUpgrade();
        // Faster attack speed
        this.attackSpeed = Math.max(200, this.attackSpeed - 100);
        // Longer range
        this.range += 0.5;
    }
}

// Rapid Fire Weapon
class RapidFire extends Weapon {
    constructor() {
        super('Rapid Fire', {
            damage: 6,
            attackSpeed: 300,
            range: 6,
            maxLevel: 8,
            description: 'High fire rate, lower damage per shot',
            projectile: {
                speed: 0.7,
                size: 0.2,
                lifetime: 45,
                color: new BABYLON.Color3(0.2, 1, 0.2),
                emissive: new BABYLON.Color3(0.1, 0.5, 0.1)
            }
        });
    }
    
    attack(game, from, targets) {
        const target = this.findNearestTarget(game, targets);
        if (target) {
            game.createProjectile(from, target.position, this);
            return true;
        }
        return false;
    }
    
    findNearestTarget(game, targets) {
        let nearest = null;
        let minDist = Infinity;
        
        targets.forEach(target => {
            const dist = BABYLON.Vector3.Distance(
                game.state.playerMesh.position, 
                target.position
            );
            if (dist < minDist && dist <= this.range) {
                minDist = dist;
                nearest = target;
            }
        });
        
        return nearest;
    }
    
    applyUpgrade() {
        this.damage = Math.floor(this.damage * 1.15);
        this.attackSpeed = Math.max(150, this.attackSpeed - 30);
        this.range += 0.3;
    }
}

// Shotgun Weapon
class Shotgun extends Weapon {
    constructor() {
        super('Shotgun', {
            damage: 8,
            attackSpeed: 1500,
            range: 5,
            maxLevel: 6,
            description: 'Fires multiple projectiles in a spread',
            projectile: {
                speed: 0.4,
                size: 0.25,
                lifetime: 40,
                color: new BABYLON.Color3(1, 0.5, 0),
                emissive: new BABYLON.Color3(0.5, 0.25, 0)
            }
        });
        this.projectileCount = 3;
        this.spreadAngle = Math.PI / 6; // 30 degrees
    }
    
    attack(game, from, targets) {
        const target = this.findNearestTarget(game, targets);
        if (target) {
            const baseDirection = target.position.subtract(from).normalize();
            
            for (let i = 0; i < this.projectileCount; i++) {
                const angleOffset = (i - (this.projectileCount - 1) / 2) * (this.spreadAngle / this.projectileCount);
                const cos = Math.cos(angleOffset);
                const sin = Math.sin(angleOffset);
                
                const spreadDirection = new BABYLON.Vector3(
                    baseDirection.x * cos - baseDirection.z * sin,
                    baseDirection.y,
                    baseDirection.x * sin + baseDirection.z * cos
                );
                
                const targetPos = from.add(spreadDirection.scale(this.range));
                game.createProjectile(from, targetPos, this);
            }
            return true;
        }
        return false;
    }
    
    findNearestTarget(game, targets) {
        let nearest = null;
        let minDist = Infinity;
        
        targets.forEach(target => {
            const dist = BABYLON.Vector3.Distance(
                game.state.playerMesh.position, 
                target.position
            );
            if (dist < minDist && dist <= this.range) {
                minDist = dist;
                nearest = target;
            }
        });
        
        return nearest;
    }
    
    applyUpgrade() {
        this.damage = Math.floor(this.damage * 1.1);
        if (this.level % 2 === 0) {
            this.projectileCount++;
        }
        this.spreadAngle += 0.1;
        this.attackSpeed = Math.max(800, this.attackSpeed - 100);
    }
}

// Area of Effect Weapon
class AreaBlast extends Weapon {
    constructor() {
        super('Area Blast', {
            damage: 15,
            attackSpeed: 2000,
            range: 7,
            maxLevel: 6,
            description: 'Creates explosions that damage all nearby enemies',
            projectile: {
                speed: 0.3,
                size: 0.4,
                lifetime: 50,
                color: new BABYLON.Color3(1, 0.2, 1),
                emissive: new BABYLON.Color3(0.5, 0.1, 0.5)
            }
        });
        this.explosionRadius = 2;
    }
    
    attack(game, from, targets) {
        const target = this.findNearestTarget(game, targets);
        if (target) {
            game.createExplosiveProjectile(from, target.position, this);
            return true;
        }
        return false;
    }
    
    findNearestTarget(game, targets) {
        let nearest = null;
        let minDist = Infinity;
        
        targets.forEach(target => {
            const dist = BABYLON.Vector3.Distance(
                game.state.playerMesh.position, 
                target.position
            );
            if (dist < minDist && dist <= this.range) {
                minDist = dist;
                nearest = target;
            }
        });
        
        return nearest;
    }
    
    applyUpgrade() {
        this.damage = Math.floor(this.damage * 1.25);
        this.explosionRadius += 0.5;
        this.attackSpeed = Math.max(1000, this.attackSpeed - 150);
    }
}

// Laser Weapon
class LaserBeam extends Weapon {
    constructor() {
        super('Laser Beam', {
            damage: 5,
            attackSpeed: 100, // Very fast for continuous damage
            range: 12,
            maxLevel: 7,
            description: 'Continuous beam that damages enemies',
            projectile: {
                speed: 2.0,
                size: 0.15,
                lifetime: 25,
                color: new BABYLON.Color3(0, 1, 1),
                emissive: new BABYLON.Color3(0, 0.5, 0.5)
            }
        });
    }
    
    attack(game, from, targets) {
        const target = this.findNearestTarget(game, targets);
        if (target) {
            // Create multiple small projectiles for laser effect
            for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                    if (target && !target.isDisposed) {
                        game.createProjectile(from, target.position, this);
                    }
                }, i * 20);
            }
            return true;
        }
        return false;
    }
    
    findNearestTarget(game, targets) {
        let nearest = null;
        let minDist = Infinity;
        
        targets.forEach(target => {
            const dist = BABYLON.Vector3.Distance(
                game.state.playerMesh.position, 
                target.position
            );
            if (dist < minDist && dist <= this.range) {
                minDist = dist;
                nearest = target;
            }
        });
        
        return nearest;
    }
    
    applyUpgrade() {
        this.damage = Math.floor(this.damage * 1.1);
        this.range += 1;
        this.attackSpeed = Math.max(50, this.attackSpeed - 10);
    }
}

// Weapon Factory
class WeaponFactory {
    static createWeapon(type) {
        switch (type) {
            case 'basic':
                return new BasicBlaster();
            case 'rapid':
                return new RapidFire();
            case 'shotgun':
                return new Shotgun();
            case 'area':
                return new AreaBlast();
            case 'laser':
                return new LaserBeam();
            default:
                return new BasicBlaster();
        }
    }
    
    static getAllWeaponTypes() {
        return ['basic', 'rapid', 'shotgun', 'area', 'laser'];
    }
    
    static getWeaponInfo(type) {
        const weapon = this.createWeapon(type);
        return {
            name: weapon.name,
            description: weapon.description,
            damage: weapon.damage,
            attackSpeed: weapon.attackSpeed,
            range: weapon.range
        };
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Weapon,
        BasicBlaster,
        RapidFire,
        Shotgun,
        AreaBlast,
        LaserBeam,
        WeaponFactory
    };
}