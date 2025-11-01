/**
 * SpawnManager - Manages enemy spawning with configurable spawn points, frequency, and modifiers
 * Supports both pre-game config and dynamic in-game modifications
 */

class SpawnManager {
    constructor(game, config) {
        this.game = game;
        this.config = config; // Pre-game configuration from CONFIG.spawn

        // Runtime spawn modifiers (can be changed dynamically by upgrades, events, etc.)
        this.modifiers = {
            spawnRateMultiplier: 1.0,      // < 1.0 = slower, > 1.0 = faster spawning
            spawnCountMultiplier: 1.0,     // Multiplier for enemies per spawn
            enemyHealthMultiplier: 1.0,    // Scale enemy HP
            enemyDamageMultiplier: 1.0,    // Scale enemy damage
            spawnRadiusMultiplier: 1.0,    // Scale spawn distance from player
            bossSpawnChanceMultiplier: 1.0 // Modify boss spawn frequency
        };

        // Difficulty scaling over time
        this.difficultyScaling = {
            enabled: true,
            timeScaleInterval: 60000,      // Scale difficulty every 60 seconds
            maxTimeScaling: 3.0,           // Cap at 3x difficulty from time
            spawnRateIncrease: 0.05,       // +5% spawn rate per interval
            enemyStatIncrease: 0.03        // +3% enemy stats per interval
        };

        // Wave state
        this.currentWave = 1;
        this.waveStartTime = Date.now();
        this.lastSpawnTime = 0;

        // Spawn patterns
        this.spawnPatterns = {
            circle: this.spawnCirclePattern.bind(this),
            grid: this.spawnGridPattern.bind(this),
            directional: this.spawnDirectionalPattern.bind(this),
            fixed: this.spawnFixedPattern.bind(this),
            line: this.spawnLinePattern.bind(this)
        };

        // Active spawn points (can be added dynamically)
        this.activeSpawnPoints = [];

        // Spawn event queue (for future timed/triggered events)
        this.spawnEvents = [];
    }

    /**
     * Main update loop - call every frame
     */
    update(currentTime, player, enemies) {
        // Update wave system
        this.updateWaveSystem(currentTime);

        // Process spawn events (future feature)
        this.processSpawnEvents(currentTime);

        // Check if it's time to spawn
        const effectiveSpawnRate = this.getEffectiveSpawnRate();
        if (currentTime - this.lastSpawnTime > effectiveSpawnRate) {
            this.spawnEnemies(player, enemies);
            this.lastSpawnTime = currentTime;
        }
    }

    /**
     * Update wave progression
     */
    updateWaveSystem(currentTime) {
        const waveConfig = this.getWaveConfig();
        const waveElapsed = currentTime - this.waveStartTime;

        // Check for wave transition
        if (waveElapsed > waveConfig.duration) {
            this.currentWave++;
            this.waveStartTime = currentTime;
            this.onWaveComplete();
        }
    }

    /**
     * Spawn enemies based on current configuration
     */
    spawnEnemies(player, enemies) {
        const waveConfig = this.getWaveConfig();
        const spawnCount = this.getEffectiveSpawnCount(waveConfig.spawnCount || 1);

        for (let i = 0; i < spawnCount; i++) {
            // Determine enemy type
            const enemyType = this.selectEnemyType(waveConfig);

            // Determine spawn pattern
            const pattern = waveConfig.spawnPattern || this.config.defaultSpawnPattern;

            // Get spawn position
            const position = this.getSpawnPosition(pattern, player, i, spawnCount);

            // Create enemy with modifiers
            const enemy = this.createEnemy(enemyType, position);

            if (enemy) {
                enemies.push(enemy);
            }
        }
    }

    /**
     * Create an enemy with stat modifiers applied
     */
    createEnemy(type, position) {
        const enemy = EnemyFactory.createEnemy(type, this.game.scene.scene);

        if (!enemy) return null;

        // Apply position
        enemy.mesh.position.copy(position);

        // Apply difficulty modifiers
        const healthMod = this.getEffectiveHealthMultiplier();
        const damageMod = this.getEffectiveDamageMultiplier();

        enemy.maxHealth *= healthMod;
        enemy.health *= healthMod;
        enemy.damage = Math.round(enemy.damage * damageMod);

        return enemy;
    }

    /**
     * Select enemy type based on wave configuration
     */
    selectEnemyType(waveConfig) {
        // Check for boss spawn
        if (EnemyFactory.shouldSpawnBoss(this.currentWave) &&
            Math.random() < (0.1 * this.modifiers.bossSpawnChanceMultiplier)) {
            return 'boss';
        }

        // Wave-specific enemy list
        if (waveConfig.enemies && waveConfig.enemies.length > 0) {
            if (waveConfig.enemies[0] === 'all') {
                return EnemyFactory.getRandomEnemyType(this.currentWave);
            } else {
                return waveConfig.enemies[Math.floor(Math.random() * waveConfig.enemies.length)];
            }
        }

        // Fallback to wave-based random
        return EnemyFactory.getRandomEnemyType(this.currentWave);
    }

    /**
     * Get spawn position based on pattern type
     */
    getSpawnPosition(pattern, player, index, totalCount) {
        const spawnFunction = this.spawnPatterns[pattern] || this.spawnPatterns.circle;
        return spawnFunction(player, index, totalCount);
    }

    /**
     * SPAWN PATTERNS
     */

    /**
     * Circle pattern - spawn randomly around player in a circle
     */
    spawnCirclePattern(player, index, totalCount) {
        const angle = Math.random() * Math.PI * 2;
        const baseDistance = this.config.spawnDistance || 12;
        const variance = this.config.spawnDistanceVariance || 5;
        const distance = (baseDistance + Math.random() * variance) * this.modifiers.spawnRadiusMultiplier;

        return new THREE.Vector3(
            player.mesh.position.x + Math.cos(angle) * distance,
            0.5,
            player.mesh.position.z + Math.sin(angle) * distance
        );
    }

    /**
     * Grid pattern - spawn in a grid formation around player
     */
    spawnGridPattern(player, index, totalCount) {
        const gridSize = Math.ceil(Math.sqrt(totalCount));
        const row = Math.floor(index / gridSize);
        const col = index % gridSize;

        const baseDistance = this.config.spawnDistance || 12;
        const spacing = 3 * this.modifiers.spawnRadiusMultiplier;

        const offsetX = (col - gridSize / 2) * spacing;
        const offsetZ = (row - gridSize / 2) * spacing;

        return new THREE.Vector3(
            player.mesh.position.x + offsetX + baseDistance,
            0.5,
            player.mesh.position.z + offsetZ + baseDistance
        );
    }

    /**
     * Directional pattern - spawn from a specific direction
     */
    spawnDirectionalPattern(player, index, totalCount) {
        // Pick a cardinal direction (N, S, E, W) or use current wave
        const directions = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
        const baseAngle = directions[this.currentWave % 4];

        // Spread enemies along an arc in that direction
        const spreadAngle = Math.PI / 3; // 60 degree spread
        const angle = baseAngle + (Math.random() - 0.5) * spreadAngle;

        const baseDistance = this.config.spawnDistance || 12;
        const distance = (baseDistance + Math.random() * 5) * this.modifiers.spawnRadiusMultiplier;

        return new THREE.Vector3(
            player.mesh.position.x + Math.cos(angle) * distance,
            0.5,
            player.mesh.position.z + Math.sin(angle) * distance
        );
    }

    /**
     * Line pattern - spawn in a line formation
     */
    spawnLinePattern(player, index, totalCount) {
        const angle = (this.currentWave * Math.PI / 4) % (Math.PI * 2); // Rotate line each wave
        const perpAngle = angle + Math.PI / 2;

        const baseDistance = this.config.spawnDistance || 12;
        const spacing = 2 * this.modifiers.spawnRadiusMultiplier;
        const lineOffset = (index - totalCount / 2) * spacing;

        return new THREE.Vector3(
            player.mesh.position.x + Math.cos(angle) * baseDistance + Math.cos(perpAngle) * lineOffset,
            0.5,
            player.mesh.position.z + Math.sin(angle) * baseDistance + Math.sin(perpAngle) * lineOffset
        );
    }

    /**
     * Fixed pattern - spawn at predefined world positions
     */
    spawnFixedPattern(player, index, totalCount) {
        // Use active spawn points if any
        if (this.activeSpawnPoints.length > 0) {
            const point = this.activeSpawnPoints[index % this.activeSpawnPoints.length];
            return new THREE.Vector3(point.x, 0.5, point.z);
        }

        // Fallback to circle
        return this.spawnCirclePattern(player, index, totalCount);
    }

    /**
     * MODIFIER CALCULATIONS
     */

    /**
     * Get effective spawn rate with all modifiers applied
     */
    getEffectiveSpawnRate() {
        const waveConfig = this.getWaveConfig();
        const baseRate = waveConfig.spawnRate || 2000;

        // Apply modifiers
        let rate = baseRate / this.modifiers.spawnRateMultiplier;

        // Apply time-based difficulty scaling
        if (this.difficultyScaling.enabled) {
            const timeScaling = this.getTimeScaling();
            rate = rate / timeScaling;
        }

        return Math.max(100, rate); // Minimum 100ms between spawns
    }

    /**
     * Get effective spawn count per spawn
     */
    getEffectiveSpawnCount(baseCount = 1) {
        let count = baseCount * this.modifiers.spawnCountMultiplier;

        // Apply time-based scaling (more enemies over time)
        if (this.difficultyScaling.enabled) {
            const timeScaling = this.getTimeScaling();
            count = count * (1 + (timeScaling - 1) * 0.5); // Half the time scaling effect on count
        }

        return Math.max(1, Math.round(count));
    }

    /**
     * Get effective health multiplier
     */
    getEffectiveHealthMultiplier() {
        let multiplier = this.modifiers.enemyHealthMultiplier;

        if (this.difficultyScaling.enabled) {
            const timeScaling = this.getTimeScaling();
            multiplier *= (1 + (timeScaling - 1) * this.difficultyScaling.enemyStatIncrease / this.difficultyScaling.spawnRateIncrease);
        }

        return multiplier;
    }

    /**
     * Get effective damage multiplier
     */
    getEffectiveDamageMultiplier() {
        let multiplier = this.modifiers.enemyDamageMultiplier;

        if (this.difficultyScaling.enabled) {
            const timeScaling = this.getTimeScaling();
            multiplier *= (1 + (timeScaling - 1) * this.difficultyScaling.enemyStatIncrease / this.difficultyScaling.spawnRateIncrease);
        }

        return multiplier;
    }

    /**
     * Calculate time-based difficulty scaling
     */
    getTimeScaling() {
        const gameTime = Date.now() - this.game.state.startTime;
        const intervals = Math.floor(gameTime / this.difficultyScaling.timeScaleInterval);
        const scaling = 1 + (intervals * this.difficultyScaling.spawnRateIncrease);

        return Math.min(scaling, this.difficultyScaling.maxTimeScaling);
    }

    /**
     * Get current wave configuration
     */
    getWaveConfig() {
        const waves = this.config.waves || CONFIG.waves;
        return waves[this.currentWave] || waves[8] || {
            duration: 60000,
            enemies: ['all'],
            spawnRate: 1000,
            spawnCount: 1,
            spawnPattern: 'circle'
        };
    }

    /**
     * DYNAMIC MODIFICATION API
     */

    /**
     * Apply a modifier (for upgrades, powerups, etc.)
     */
    applyModifier(modifierName, value, duration = null) {
        if (this.modifiers.hasOwnProperty(modifierName)) {
            this.modifiers[modifierName] *= value;

            // If temporary, schedule removal
            if (duration) {
                setTimeout(() => {
                    this.modifiers[modifierName] /= value;
                }, duration);
            }
        }
    }

    /**
     * Set a modifier to a specific value
     */
    setModifier(modifierName, value) {
        if (this.modifiers.hasOwnProperty(modifierName)) {
            this.modifiers[modifierName] = value;
        }
    }

    /**
     * Add a fixed spawn point
     */
    addSpawnPoint(x, z) {
        this.activeSpawnPoints.push({ x, z });
    }

    /**
     * Clear all spawn points
     */
    clearSpawnPoints() {
        this.activeSpawnPoints = [];
    }

    /**
     * Schedule a spawn event (for future feature)
     */
    scheduleSpawnEvent(event) {
        this.spawnEvents.push(event);
    }

    /**
     * Process scheduled spawn events
     */
    processSpawnEvents(currentTime) {
        // Future implementation for timed/triggered events
        // For now, just a placeholder
        this.spawnEvents = this.spawnEvents.filter(event => {
            if (event.triggerTime <= currentTime) {
                // Execute event
                if (event.callback) {
                    event.callback(this);
                }
                return false; // Remove from queue
            }
            return true; // Keep in queue
        });
    }

    /**
     * Wave completion callback
     */
    onWaveComplete() {
        // Hook for future features (wave completion bonuses, etc.)
        console.log(`Wave ${this.currentWave - 1} complete! Starting wave ${this.currentWave}`);
    }

    /**
     * Get spawn manager stats for UI display
     */
    getStats() {
        return {
            currentWave: this.currentWave,
            spawnRate: Math.round(this.getEffectiveSpawnRate()),
            spawnCount: this.getEffectiveSpawnCount(),
            healthMultiplier: this.getEffectiveHealthMultiplier().toFixed(2),
            damageMultiplier: this.getEffectiveDamageMultiplier().toFixed(2),
            timeScaling: this.getTimeScaling().toFixed(2),
            modifiers: { ...this.modifiers }
        };
    }
}
