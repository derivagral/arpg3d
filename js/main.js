// Main entry point
window.addEventListener('DOMContentLoaded', () => {
    // Check for WebGL support
    if (!BABYLON.Engine.isSupported()) {
        alert("Your browser doesn't support WebGL. Please try a modern browser.");
        return;
    }
    
    const canvas = document.getElementById("renderCanvas");
    const engine = new BABYLON.Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        antialias: true
    });
    
    // Create and start the game
    const game = new Game(engine, canvas);
    game.start();
    
    // Development helpers
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        // Debug mode for local development
        window.game = game; // Access game state from console
        
        // Show FPS counter
        const showFPS = true;
        if (showFPS) {
            const fpsElement = document.createElement('div');
            fpsElement.style.cssText = `
                position: absolute;
                top: 10px;
                right: 10px;
                color: white;
                font-family: monospace;
                font-size: 14px;
                text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
                background: rgba(0,0,0,0.5);
                padding: 5px 10px;
                border-radius: 5px;
                z-index: 100;
            `;
            document.body.appendChild(fpsElement);
            
            setInterval(() => {
                const fps = engine.getFps().toFixed();
                fpsElement.textContent = `FPS: ${fps}`;
                
                // Color code based on performance
                if (fps >= 55) {
                    fpsElement.style.color = '#00ff00';
                } else if (fps >= 30) {
                    fpsElement.style.color = '#ffff00';
                } else {
                    fpsElement.style.color = '#ff0000';
                }
            }, 100);
        }
        
        // Debug commands
        window.debugCommands = {
            // Give XP
            giveXP: (amount = 100) => {
                game.player.stats.xp += amount;
                console.log(`Added ${amount} XP`);
            },

            // Set health
            setHealth: (amount) => {
                game.player.stats.health = Math.min(amount, game.player.stats.maxHealth);
                game.ui.updateHealthBar();
                console.log(`Health set to ${amount}`);
            },

            // Skip to wave
            skipToWave: (waveNum) => {
                game.spawnManager.currentWave = waveNum;
                game.spawnManager.waveStartTime = Date.now();
                game.ui.showWaveIndicator(waveNum);
                console.log(`Skipped to wave ${waveNum}`);
            },

            // Clear enemies
            clearEnemies: () => {
                game.state.enemies.forEach(enemy => {
                    if (enemy.destroy) enemy.destroy();
                    else if (enemy.dispose) enemy.dispose();
                });
                game.state.enemies = [];
                console.log('All enemies cleared');
            },

            // God mode
            godMode: () => {
                game.player.stats.health = 99999;
                game.player.stats.maxHealth = 99999;
                game.player.stats.damage = 9999;
                game.ui.updateHealthBar();
                console.log('God mode activated');
            },

            // Spawn specific enemy
            spawnEnemy: (type = 'basic', count = 1) => {
                for (let i = 0; i < count; i++) {
                    const enemy = EnemyFactory.createEnemy(type, game.scene);
                    if (enemy) {
                        const angle = Math.random() * Math.PI * 2;
                        const distance = 12 + Math.random() * 5;
                        enemy.mesh.position.x = game.player.mesh.position.x + Math.cos(angle) * distance;
                        enemy.mesh.position.z = game.player.mesh.position.z + Math.sin(angle) * distance;
                        enemy.mesh.position.y = 0.5;
                        game.state.enemies.push(enemy);
                    }
                }
                console.log(`Spawned ${count} ${type} enemies`);
            },

            // Spawn system debug commands
            setSpawnRate: (multiplier) => {
                game.spawnManager.setModifier('spawnRateMultiplier', multiplier);
                console.log(`Spawn rate multiplier set to ${multiplier}x`);
            },

            setSpawnCount: (multiplier) => {
                game.spawnManager.setModifier('spawnCountMultiplier', multiplier);
                console.log(`Spawn count multiplier set to ${multiplier}x`);
            },

            getSpawnStats: () => {
                const stats = game.spawnManager.getStats();
                console.log('Current Spawn Stats:', stats);
                return stats;
            },

            setSpawnPattern: (pattern) => {
                const wave = game.spawnManager.getWaveConfig();
                wave.spawnPattern = pattern;
                console.log(`Spawn pattern set to: ${pattern}`);
                console.log('Available patterns: circle, grid, directional, line, fixed');
            },

            toggleDifficultyScaling: () => {
                game.spawnManager.difficultyScaling.enabled = !game.spawnManager.difficultyScaling.enabled;
                console.log(`Difficulty scaling: ${game.spawnManager.difficultyScaling.enabled ? 'ON' : 'OFF'}`);
            }
        };
        
        console.log(`
            🎮 Debug Mode Enabled
            ==================
            Access game state: window.game
            Debug commands: window.debugCommands

            Basic Commands:
            - debugCommands.giveXP(amount)
            - debugCommands.setHealth(amount)
            - debugCommands.skipToWave(waveNum)
            - debugCommands.clearEnemies()
            - debugCommands.godMode()
            - debugCommands.spawnEnemy(type, count)

            Spawn System Commands:
            - debugCommands.setSpawnRate(multiplier)      // 2.0 = 2x faster spawning
            - debugCommands.setSpawnCount(multiplier)     // 3.0 = 3x more enemies
            - debugCommands.getSpawnStats()               // View current spawn stats
            - debugCommands.setSpawnPattern(pattern)      // circle, grid, directional, line, fixed
            - debugCommands.toggleDifficultyScaling()     // Enable/disable time-based scaling

            Enemy types: basic, fast, tank, explosive, ranged, boss, swarm
        `);
    }
    
    // Handle window resize
    window.addEventListener("resize", () => {
        engine.resize();
    });
    
    // Handle page visibility (pause when tab is hidden)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && !game.state.paused) {
            game.togglePause();
        }
    });
    
    // Prevent context menu on canvas
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        return false;
    });
    
    // Performance optimization for mobile
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        // Reduce quality for mobile
        engine.setHardwareScalingLevel(2);
        console.log('Mobile device detected - reduced quality for performance');
    }
});