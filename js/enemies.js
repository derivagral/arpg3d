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

        // Elite properties (set by SpawnManager.promoteToElite)
        this.isElite = false;
        this.eliteDropBonus = false;
        this.eliteRing = null;
        this.lastEliteAction = 0;
        this.eliteAbilityCooldown = CONFIG.elite.abilityCooldown;
        this.eliteSplitUsed = false; // For swarm split (one-time)

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

        // Update elite ring orbit
        if (this.isElite && this.eliteRing && this.mesh) {
            this.eliteRing.rotation.y += 0.03;
        }
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
        if (this.eliteRing) {
            this.eliteRing.dispose();
            this.eliteRing = null;
        }
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

    performAction(game, currentTime) {
        // Elite: Ground Slam — AOE circle (radius 2, 800ms)
        if (this.isElite && game.indicatorManager &&
            currentTime - this.lastEliteAction > this.eliteAbilityCooldown) {
            const distToPlayer = BABYLON.Vector3.Distance(
                this.mesh.position, game.player.mesh.position
            );
            if (distToPlayer < 3) {
                this.lastEliteAction = currentTime;
                const pos = this.mesh.position.clone();
                const slamDmg = Math.round(this.damage * 1.5);
                game.indicatorManager.createAOEIndicator(pos, 2, 800, null, () => {
                    // Deal damage to player if in range
                    const d = BABYLON.Vector3.Distance(
                        pos, game.player.mesh.position
                    );
                    if (d < 2) {
                        game.player.lastDamageSource = { name: 'Elite Basic (Slam)', damage: slamDmg, type: 'elite' };
                        game.player.takeDamage(slamDmg);
                    }
                });
            }
        }
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
        this.isDashing = false;
    }

    move(game) {
        if (this.isDashing) return; // Don't move during dash

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

    performAction(game, currentTime) {
        // Elite: Dash Strike — direction line (600ms), lunge ~6 units
        if (this.isElite && game.indicatorManager && !this.isDashing &&
            currentTime - this.lastEliteAction > this.eliteAbilityCooldown) {
            const distToPlayer = BABYLON.Vector3.Distance(
                this.mesh.position, game.player.mesh.position
            );
            if (distToPlayer < 8 && distToPlayer > 2) {
                this.lastEliteAction = currentTime;
                const dir = game.player.mesh.position.subtract(this.mesh.position);
                dir.y = 0;
                dir.normalize();
                const from = this.mesh.position.clone();
                const to = from.add(dir.scale(6));

                game.indicatorManager.createLineIndicator(from, to, 0.4, 600, [0.2, 1, 0.2]);

                this.isDashing = true;
                setTimeout(() => {
                    if (!this.mesh) { this.isDashing = false; return; }
                    const dashSpeed = 0.25;
                    const dashDuration = 300;
                    const dashStart = Date.now();
                    const dashInterval = setInterval(() => {
                        if (Date.now() - dashStart > dashDuration || !this.mesh) {
                            clearInterval(dashInterval);
                            this.isDashing = false;
                            return;
                        }
                        this.mesh.position.addInPlace(dir.scale(dashSpeed));
                        // Check hit on player during dash
                        const d = BABYLON.Vector3.Distance(this.mesh.position, game.player.mesh.position);
                        if (d < 1) {
                            game.player.lastDamageSource = { name: 'Elite Fast (Dash)', damage: this.damage * 2, type: 'elite' };
                            game.player.takeDamage(this.damage * 2);
                        }
                    }, 16);
                }, 600);
            }
        }
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

    performAction(game, currentTime) {
        // Elite: Shockwave — AOE circle (radius 3.5, 1000ms)
        if (this.isElite && game.indicatorManager &&
            currentTime - this.lastEliteAction > this.eliteAbilityCooldown) {
            const distToPlayer = BABYLON.Vector3.Distance(
                this.mesh.position, game.player.mesh.position
            );
            if (distToPlayer < 5) {
                this.lastEliteAction = currentTime;
                const pos = this.mesh.position.clone();
                const waveDmg = Math.round(this.damage * 1.2);
                game.indicatorManager.createAOEIndicator(pos, 3.5, 1000, [0.6, 0.6, 0.8], () => {
                    const d = BABYLON.Vector3.Distance(pos, game.player.mesh.position);
                    if (d < 3.5) {
                        game.player.lastDamageSource = { name: 'Elite Tank (Shockwave)', damage: waveDmg, type: 'elite' };
                        game.player.takeDamage(waveDmg);
                    }
                });
            }
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

    // Elite: Split — spawns 3 mini swarm on death (handled in takeDamage)
    takeDamage(amount) {
        const isDead = super.takeDamage(amount);
        if (isDead && this.isElite && !this.eliteSplitUsed) {
            this.eliteSplitUsed = true;
            this._pendingSplit = true;
        }
        return isDead;
    }

    // Called by game.js when enemy dies, to spawn split minions
    getDeathEffects(game) {
        if (!this._pendingSplit || !this.mesh) return;
        const pos = this.mesh.position.clone();
        if (game.indicatorManager) {
            game.indicatorManager.createAOEIndicator(pos, 1.5, 500, [0.2, 1, 0.2], () => {
                for (let i = 0; i < 3; i++) {
                    const angle = (i / 3) * Math.PI * 2;
                    const minion = new SwarmEnemy(this.scene);
                    minion.health = 5;
                    minion.maxHealth = 5;
                    minion.damage = 1;
                    minion.mesh.position.x = pos.x + Math.cos(angle) * 1;
                    minion.mesh.position.z = pos.z + Math.sin(angle) * 1;
                    minion.mesh.position.y = 0.2;
                    game.state.enemies.push(minion);
                }
            });
        }
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
            // Store pending explosion — telegraph first, then explode
            this._pendingExplosion = true;
        }
        return isDead;
    }

    // Called by game.js when this enemy dies
    triggerTelegraphedExplosion(game) {
        if (!this.mesh) return;
        const pos = this.mesh.position.clone();
        const radius = this.isElite ? 4 : this.explosionRadius;
        const dmg = this.isElite ? this.explosionDamage * 1.5 : this.explosionDamage;
        const telegraphMs = this.isElite ? 1000 : 500;

        if (game.indicatorManager) {
            game.indicatorManager.createAOEIndicator(pos, radius, telegraphMs, null, () => {
                this.executeExplosion(game, pos, radius, dmg);
                if (this.isElite) {
                    // Elite: Chain Detonation — leave burning ground for 2s
                    this.createBurningGround(game, pos, radius);
                }
            });
        } else {
            this.executeExplosion(game, pos, radius, dmg);
        }
    }

    executeExplosion(game, pos, radius, dmg) {
        // Visual explosion sphere
        const explosion = BABYLON.MeshBuilder.CreateSphere(
            'explosion', { diameter: radius * 2 }, this.scene
        );
        explosion.position = pos.clone();
        const explosionMat = new BABYLON.StandardMaterial('explosionMat', this.scene);
        explosionMat.diffuseColor = new BABYLON.Color3(1, 0.5, 0);
        explosionMat.emissiveColor = new BABYLON.Color3(1, 0.8, 0);
        explosionMat.alpha = 0.5;
        explosion.material = explosionMat;

        BABYLON.Animation.CreateAndStartAnimation(
            'explosionScale', explosion, 'scaling', 30, 15,
            new BABYLON.Vector3(0.1, 0.1, 0.1), new BABYLON.Vector3(1, 1, 1),
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        BABYLON.Animation.CreateAndStartAnimation(
            'explosionAlpha', explosion.material, 'alpha', 30, 15,
            0.5, 0, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        setTimeout(() => explosion.dispose(), 500);

        // Damage player if in radius
        const dist = BABYLON.Vector3.Distance(pos, game.player.mesh.position);
        if (dist < radius) {
            game.player.lastDamageSource = {
                name: this.isElite ? 'Elite Explosive (Chain Detonation)' : 'Explosive',
                damage: dmg, type: 'explosion'
            };
            game.player.takeDamage(dmg);
        }
    }

    createBurningGround(game, pos, radius) {
        const burning = BABYLON.MeshBuilder.CreateDisc(
            'burning_ground', { radius: radius, tessellation: 24 }, this.scene
        );
        burning.position = new BABYLON.Vector3(pos.x, 0.06, pos.z);
        burning.rotation.x = Math.PI / 2;
        const burnMat = new BABYLON.StandardMaterial('burnMat', this.scene);
        burnMat.diffuseColor = new BABYLON.Color3(1, 0.3, 0);
        burnMat.emissiveColor = new BABYLON.Color3(0.8, 0.2, 0);
        burnMat.alpha = 0.15;
        burnMat.disableDepthWrite = true;
        burnMat.backFaceCulling = false;
        burning.material = burnMat;
        burning.renderingGroupId = 1;

        const burnDmg = 3;
        const burnEnd = Date.now() + 2000;
        const burnInterval = setInterval(() => {
            if (Date.now() > burnEnd) {
                clearInterval(burnInterval);
                burning.dispose();
                return;
            }
            const d = BABYLON.Vector3.Distance(pos, game.player.mesh.position);
            if (d < radius) {
                game.player.lastDamageSource = { name: 'Burning Ground', damage: burnDmg, type: 'dot' };
                game.player.takeDamage(burnDmg);
            }
            // Fade out over time
            burnMat.alpha = 0.15 * ((burnEnd - Date.now()) / 2000);
        }, 500);
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
            this.telegraphedShot(game);
            this.lastAction = currentTime;
        }

        // Elite: Triple Shot on separate cooldown
        if (this.isElite && game.indicatorManager &&
            currentTime - this.lastEliteAction > this.eliteAbilityCooldown &&
            distToPlayer <= this.attackRange) {
            this.lastEliteAction = currentTime;
            this.tripleShot(game);
        }
    }

    telegraphedShot(game) {
        if (!this.mesh) return;

        const from = this.mesh.position.clone();
        const dir = game.player.mesh.position.subtract(from);
        dir.y = 0;
        dir.normalize();
        const to = from.add(dir.scale(this.attackRange));

        // Telegraph line (400ms), then fire
        if (game.indicatorManager) {
            game.indicatorManager.createLineIndicator(from, to, 0.2, 400, [0.5, 0.2, 1]);
        }

        const capturedDir = dir.clone();
        const capturedFrom = from.clone();
        setTimeout(() => {
            if (!this.mesh) return;
            this.fireProjectile(game, capturedFrom, capturedDir);
        }, 400);
    }

    tripleShot(game) {
        if (!this.mesh) return;

        const from = this.mesh.position.clone();
        const dir = game.player.mesh.position.subtract(from);
        dir.y = 0;
        dir.normalize();

        const angles = [-0.3, 0, 0.3];
        angles.forEach(offset => {
            const cos = Math.cos(offset);
            const sin = Math.sin(offset);
            const spreadDir = new BABYLON.Vector3(
                dir.x * cos - dir.z * sin, 0,
                dir.x * sin + dir.z * cos
            );
            const to = from.add(spreadDir.scale(this.attackRange));
            if (game.indicatorManager) {
                game.indicatorManager.createLineIndicator(from, to, 0.15, 500, [0.7, 0.3, 1]);
            }
        });

        setTimeout(() => {
            if (!this.mesh) return;
            angles.forEach(offset => {
                const cos = Math.cos(offset);
                const sin = Math.sin(offset);
                const spreadDir = new BABYLON.Vector3(
                    dir.x * cos - dir.z * sin, 0,
                    dir.x * sin + dir.z * cos
                );
                this.fireProjectile(game, this.mesh.position.clone(), spreadDir);
            });
        }, 500);
    }

    fireProjectile(game, fromPos, direction) {
        const projectile = BABYLON.MeshBuilder.CreateSphere(
            'enemyProjectile',
            {diameter: CONFIG.enemyProjectiles.ranged.size},
            this.scene
        );

        projectile.position = fromPos.clone();
        projectile.position.y = 0.8;

        const projectileMat = new BABYLON.StandardMaterial('enemyProjectileMat', this.scene);
        projectileMat.diffuseColor = new BABYLON.Color3(1, 0, 1);
        projectileMat.emissiveColor = new BABYLON.Color3(0.5, 0, 0.5);
        projectile.material = projectileMat;

        projectile.velocity = direction.scale(this.projectileSpeed);
        projectile.damage = this.damage;
        projectile.sourceName = this.isElite ? 'Elite Ranged' : (this.name || 'Ranged');
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
        if (!this.mesh) return;

        const direction = game.player.mesh.position.subtract(this.mesh.position);
        direction.y = 0;
        direction.normalize();

        const chargeSpeed = 0.1;
        const chargeDuration = 1000;
        const chargeLength = 8;

        // Telegraph: direction line (600ms dodge window)
        const from = this.mesh.position.clone();
        const to = from.add(direction.scale(chargeLength));
        if (game.indicatorManager) {
            game.indicatorManager.createLineIndicator(from, to, 0.5, 600);
        }

        setTimeout(() => {
            if (!this.mesh) return;
            const startTime = Date.now();
            const chargeInterval = setInterval(() => {
                if (Date.now() - startTime > chargeDuration || !this.mesh) {
                    clearInterval(chargeInterval);
                    return;
                }
                this.mesh.position.addInPlace(direction.scale(chargeSpeed));
            }, 16);
        }, 600);
    }

    summonMinions(game) {
        if (!this.mesh) return;

        const pos = this.mesh.position.clone();

        // Telegraph: AOE circle (500ms)
        if (game.indicatorManager) {
            game.indicatorManager.createAOEIndicator(pos, 3, 500, [0.8, 0, 0.8], () => {
                if (!this.mesh) return;
                for (let i = 0; i < 3; i++) {
                    const angle = (i / 3) * Math.PI * 2;
                    const distance = 3;
                    const minion = new BasicEnemy(this.scene);
                    minion.mesh.position.x = pos.x + Math.cos(angle) * distance;
                    minion.mesh.position.z = pos.z + Math.sin(angle) * distance;
                    minion.mesh.position.y = 0.4;
                    game.state.enemies.push(minion);
                }
            });
        } else {
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
    }

    projectileBarrage(game) {
        if (!this.mesh) return;

        const pos = this.mesh.position.clone();

        // Telegraph: AOE circle (800ms)
        if (game.indicatorManager) {
            game.indicatorManager.createAOEIndicator(pos, 4, 800, [0.8, 0, 0.8], () => {
                this.fireBarrage(game);
            });
        } else {
            this.fireBarrage(game);
        }
    }

    fireBarrage(game) {
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const direction = new BABYLON.Vector3(Math.cos(angle), 0, Math.sin(angle));

            setTimeout(() => {
                if (!this.mesh) return;

                const projectile = BABYLON.MeshBuilder.CreateSphere(
                    'bossProjectile',
                    {diameter: CONFIG.enemyProjectiles.boss.size},
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
                projectile.sourceName = 'Boss';
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
