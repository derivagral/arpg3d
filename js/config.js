// Game Configuration
const CONFIG = {
    player: {
        initialHealth: 100,
        initialSpeed: 0.15,
        initialDamage: 10,
        initialAttackSpeed: 1000, // ms between attacks
        initialAttackRange: 3,
        pickupRadius: 2,
        magnetRadius: 4,
        levelUpHealthBonus: 10,
        levelUpDamageBonus: 5,
        levelUpHeal: 20,
        attackSpeedReduction: 100, // ms reduced per level
        minAttackSpeed: 200 // minimum ms between attacks
    },
    
    enemies: {
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
        spawnRate: 2000,
        spawnRateReduction: 50,
        minSpawnRate: 500,
        spawnDistance: 10,
        spawnDistanceVariance: 5,
        maxEnemiesBeforeDifficultyIncrease: 10
    },
    
    projectiles: {
        basic: {
            speed: 0.5,
            size: 0.3,
            lifetime: 60, // frames
            color: new BABYLON.Color3(1, 1, 0),
            emissive: new BABYLON.Color3(1, 0.8, 0)
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
        groundSize: 50,
        cameraHeight: 25,
        cameraOffset: 8,
        cameraAngle: Math.PI / 2.2
    },
    
    ui: {
        healthBarWidth: 250,
        updateInterval: 100 // ms
    }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
