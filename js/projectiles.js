// Projectile Manager
class ProjectileManager {
    constructor(game) {
        this.game = game;
        this.projectiles = [];
        this.enemyProjectiles = [];
    }

    createProjectile(from, to, playerStats) {
        const projectile = BABYLON.MeshBuilder.CreateSphere(
            "projectile",
            {diameter: CONFIG.projectiles.basic.size},
            this.game.scene
        );

        projectile.position = from.clone();
        projectile.position.y = 0.8;

        const projectileMat = new BABYLON.StandardMaterial("projectileMat", this.game.scene);

        // Apply crit chance
        let damage = playerStats.damage;
        let isCrit = Math.random() < playerStats.critChance;

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
        projectile.piercing = playerStats.piercing;
        projectile.hitEnemies = [];

        this.projectiles.push(projectile);
        return projectile;
    }

    update(enemies, playerMesh, onEnemyKilled, onLifeSteal) {
        if (this.game.state.paused) return;

        this.projectiles = this.projectiles.filter(projectile => {
            projectile.position.addInPlace(projectile.velocity);
            projectile.lifetime--;

            // Check collision with enemies
            for (let i = enemies.length - 1; i >= 0; i--) {
                const enemy = enemies[i];

                // Skip if already hit by this projectile
                if (projectile.hitEnemies && projectile.hitEnemies.includes(enemy)) {
                    continue;
                }

                const enemyPos = enemy.mesh ? enemy.mesh.position : enemy.position;
                const dist = BABYLON.Vector3.Distance(projectile.position, enemyPos);

                if (dist < 0.8) {
                    // Damage enemy
                    const isDead = enemy.takeDamage ?
                        enemy.takeDamage(projectile.damage) :
                        this.damageOldEnemy(enemy, projectile.damage);

                    // Track hit enemy for piercing
                    if (!projectile.hitEnemies) projectile.hitEnemies = [];
                    projectile.hitEnemies.push(enemy);

                    if (isDead) {
                        // Trigger callbacks
                        if (onLifeSteal) onLifeSteal();
                        if (onEnemyKilled) onEnemyKilled(enemy, enemyPos);

                        // Remove enemy
                        if (enemy.destroy) {
                            enemy.destroy();
                        } else if (enemy.dispose) {
                            enemy.dispose();
                        }
                        enemies.splice(i, 1);
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

    // Helper for old-style enemies (backwards compatibility)
    damageOldEnemy(enemy, damage) {
        if (!enemy.health) return false;
        enemy.health -= damage;
        return enemy.health <= 0;
    }

    updateEnemyProjectiles(playerMesh, onPlayerHit) {
        if (this.game.state.paused) return;

        this.enemyProjectiles = this.enemyProjectiles.filter(projectile => {
            projectile.position.addInPlace(projectile.velocity);
            projectile.lifetime--;

            // Check collision with player
            const dist = BABYLON.Vector3.Distance(projectile.position, playerMesh.position);

            if (dist < 0.8) {
                if (onPlayerHit) onPlayerHit(projectile.damage);
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

    addEnemyProjectile(projectile) {
        this.enemyProjectiles.push(projectile);
    }

    clear() {
        this.projectiles.forEach(p => p.dispose());
        this.enemyProjectiles.forEach(p => p.dispose());
        this.projectiles = [];
        this.enemyProjectiles = [];
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProjectileManager;
}
