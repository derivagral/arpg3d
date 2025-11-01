// Enhanced Game Configuration
const CONFIG = {
    player: {
        initialHealth: 100,
        initialSpeed: 0.15,
        initialDamage: 10,
        initialAttackSpeed: 1000, // ms between attacks
        initialAttackRange: 8, // Increased from 3
        pickupRadius: 2,
        magnetRadius: 5, // Increased from 4
        levelUpHealthBonus: 10,
        levelUpDamageBonus: 5,
        levelUpHeal: 20,
        attackSpeedReduction: 50, // ms reduced per level
        minAttackSpeed: 200, // minimum ms between attacks
        showRangeIndicator: true // Visual helper
    },
    
    enemies: {
        types: {
            basic: {
                health: 30,
                speed: 0.03,
                speedVariance: 0.02,
                damage: 5,
                size: 0.8,
                color: new BABYLON.Color3(1, 0.2, 0.2),
                emissive: new BABYLON.Color3(0.5, 0.1, 0.1),
                xpValue: 1
            },
            fast: {
                health: 20,
                speed: 0.08,
                speedVariance: 0.03,
                damage: 3,
                size: 0.6,
                color: new BABYLON.Color3(1, 0.8, 0.2),
                emissive: new BABYLON.Color3(0.5, 0.4, 0.1),
                xpValue: 2
            },
            tank: {
                health: 100,
                speed: 0.02,
                speedVariance: 0.01,
                damage: 10,
                size: 1.2,
                color: new BABYLON.Color3(0.4, 0.2, 0.6),
                emissive: new BABYLON.Color3(0.2, 0.1, 0.3),
                xpValue: 5
            },
            swarm: {
                health: 10,
                speed: 0.06,
                speedVariance: 0.04,
                damage: 2,
                size: 0.4,
                color: new BABYLON.Color3(0.2, 1, 0.2),
                emissive: new BABYLON.Color3(0.1, 0.5, 0.1),
                xpValue: 1
            }
        },
        spawnDistance: 12,
        spawnDistanceVariance: 5
    },

    // Spawn system configuration
    spawn: {
        // Default spawn pattern (circle, grid, directional, line, fixed)
        defaultSpawnPattern: 'circle',

        // Base spawn settings
        spawnDistance: 12,
        spawnDistanceVariance: 5,

        // Difficulty scaling over time
        difficultyScaling: {
            enabled: true,
            timeScaleInterval: 60000,      // Increase difficulty every 60 seconds
            maxTimeScaling: 3.0,           // Cap at 3x difficulty
            spawnRateIncrease: 0.05,       // +5% spawn rate per interval
            enemyStatIncrease: 0.03        // +3% enemy HP/damage per interval
        },

        // Wave configuration (can be customized per wave below)
        waves: null  // Will use CONFIG.waves if not overridden
    },

    waves: {
        1: {
            duration: 30000,
            enemies: ['basic'],
            spawnRate: 2000,
            spawnCount: 1,
            spawnPattern: 'circle',
            message: "The horde approaches!"
        },
        2: {
            duration: 40000,
            enemies: ['basic', 'basic', 'fast'],
            spawnRate: 1800,
            spawnCount: 1,
            spawnPattern: 'circle',
            message: "Speed demons join the fight!"
        },
        3: {
            duration: 45000,
            enemies: ['basic', 'fast', 'fast'],
            spawnRate: 1600,
            spawnCount: 1,
            spawnPattern: 'directional',
            message: "They're getting faster!"
        },
        4: {
            duration: 50000,
            enemies: ['basic', 'fast', 'tank'],
            spawnRate: 1500,
            spawnCount: 1,
            spawnPattern: 'circle',
            message: "Heavy units incoming!"
        },
        5: {
            duration: 60000,
            enemies: ['basic', 'fast', 'tank', 'swarm', 'swarm'],
            spawnRate: 1400,
            spawnCount: 2,
            spawnPattern: 'circle',
            message: "The swarm arrives!"
        },
        6: {
            duration: 60000,
            enemies: ['fast', 'tank', 'swarm', 'swarm'],
            spawnRate: 1200,
            spawnCount: 2,
            spawnPattern: 'line',
            message: "Chaos unleashed!"
        },
        7: {
            duration: 70000,
            enemies: ['tank', 'tank', 'fast', 'swarm'],
            spawnRate: 1000,
            spawnCount: 2,
            spawnPattern: 'grid',
            message: "Elite forces deployed!"
        },
        8: {
            duration: 80000,
            enemies: ['all'], // Special flag for all types
            spawnRate: 800,
            spawnCount: 3,
            spawnPattern: 'circle',
            message: "MAXIMUM THREAT!"
        }
    },

    upgrades: [
        {
            name: "Damage Boost",
            description: "Increase projectile damage",
            stat: "+25% Damage",
            apply: (game) => { game.player.stats.damage *= 1.25; }
        },
        {
            name: "Rapid Fire",
            description: "Faster attack speed",
            stat: "-20% Cooldown",
            apply: (game) => { game.player.stats.attackSpeed *= 0.8; }
        },
        {
            name: "Extended Range",
            description: "Increase attack range",
            stat: "+30% Range",
            apply: (game) => {
                game.player.stats.attackRange *= 1.3;
                game.player.rangeUpdated = true; // Flag for visual update
            }
        },
        {
            name: "Life Steal",
            description: "Heal on enemy kills",
            stat: "+5 HP per kill",
            apply: (game) => {
                game.player.stats.lifeSteal = (game.player.stats.lifeSteal || 0) + 5;
            }
        },
        {
            name: "Speed Boost",
            description: "Move faster",
            stat: "+15% Speed",
            apply: (game) => { game.player.stats.speed *= 1.15; }
        },
        {
            name: "Max Health",
            description: "Increase maximum health",
            stat: "+30 Max HP",
            apply: (game) => {
                game.player.stats.maxHealth += 30;
                game.player.stats.health += 30;
            }
        },
        {
            name: "Magnet Power",
            description: "Increase pickup range",
            stat: "+50% Pickup Range",
            apply: (game) => { game.player.stats.magnetRadius *= 1.5; }
        },
        {
            name: "Critical Chance",
            description: "Chance for double damage",
            stat: "+15% Crit",
            apply: (game) => {
                game.player.stats.critChance = (game.player.stats.critChance || 0) + 0.15;
            }
        },
        {
            name: "Piercing Shots",
            description: "Projectiles hit multiple enemies",
            stat: "+2 Pierce",
            apply: (game) => {
                game.player.stats.piercing = (game.player.stats.piercing || 0) + 2;
            }
        },
        {
            name: "Regeneration",
            description: "Slowly regenerate health",
            stat: "+1 HP/sec",
            apply: (game) => {
                game.player.stats.regen = (game.player.stats.regen || 0) + 1;
            }
        },
        // Spawn-related upgrades
        {
            name: "Swarm Training",
            description: "More enemies, more rewards",
            stat: "+20% Mob Count",
            apply: (game) => {
                if (game.spawnManager) {
                    game.spawnManager.applyModifier('spawnCountMultiplier', 1.2);
                }
            }
        },
        {
            name: "Horde Master",
            description: "They come faster now",
            stat: "+15% Spawn Rate",
            apply: (game) => {
                if (game.spawnManager) {
                    game.spawnManager.applyModifier('spawnRateMultiplier', 1.15);
                }
            }
        },
        {
            name: "Culling",
            description: "Fewer but tougher enemies",
            stat: "-30% Count, +50% Enemy Stats",
            apply: (game) => {
                if (game.spawnManager) {
                    game.spawnManager.applyModifier('spawnCountMultiplier', 0.7);
                    game.spawnManager.applyModifier('enemyHealthMultiplier', 1.5);
                    game.spawnManager.applyModifier('enemyDamageMultiplier', 1.5);
                }
            }
        },
        {
            name: "Monster Magnet",
            description: "Enemies spawn closer",
            stat: "-25% Spawn Distance",
            apply: (game) => {
                if (game.spawnManager) {
                    game.spawnManager.applyModifier('spawnRadiusMultiplier', 0.75);
                }
            }
        },
        {
            name: "Safe Distance",
            description: "Enemies spawn farther away",
            stat: "+40% Spawn Distance",
            apply: (game) => {
                if (game.spawnManager) {
                    game.spawnManager.applyModifier('spawnRadiusMultiplier', 1.4);
                }
            }
        }
    ],
    
    projectiles: {
        basic: {
            speed: 0.6, // Increased from 0.5
            size: 0.3,
            lifetime: 80, // Increased from 60
            color: new BABYLON.Color3(1, 1, 0),
            emissive: new BABYLON.Color3(1, 0.8, 0),
            critColor: new BABYLON.Color3(1, 0.5, 0),
            critEmissive: new BABYLON.Color3(1, 0.3, 0)
        }
    },
    
    pickups: {
        xp: {
            size: 0.4,
            value: 1,
            color: new BABYLON.Color3(0.2, 1, 0.2),
            emissive: new BABYLON.Color3(0.1, 0.5, 0.1)
        },
        health: {
            size: 0.4,
            value: 20,
            color: new BABYLON.Color3(1, 0.2, 0.2),
            emissive: new BABYLON.Color3(0.5, 0.1, 0.1),
            dropChance: 0.1
        },
        floatSpeed: 500, // ms for float cycle
        floatHeight: 0.1,
        rotationSpeed: 0.05,
        magnetSpeed: 0.3
    },
    
    progression: {
        xpBase: 10,
        xpMultiplier: 1.5
    },
    
    world: {
        groundSize: 60,
        cameraHeight: 30,
        cameraOffset: 15,
        cameraAngle: Math.PI / 3
    },
    
    ui: {
        healthBarWidth: 250,
        updateInterval: 100, // ms
        waveIndicatorDuration: 3000, // ms
        upgradeMenuPause: true // Pause game during upgrades
    }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}