/**
 * AreaManager - Manages area transitions and area-specific settings
 */
class AreaManager {
    constructor(game) {
        this.game = game;
        this.currentArea = 'homeBase'; // Start at home base

        // Area definitions
        this.areas = {
            homeBase: {
                name: 'Home Base',
                spawnEnemies: false,
                groundSize: 40,
                cameraHeight: 30,
                groundColor: new BABYLON.Color3(0.3, 0.5, 0.3), // Darker green
                lighting: {
                    hemisphericIntensity: 0.8,
                    directionalIntensity: 0.6
                },
                portals: [
                    {
                        position: new BABYLON.Vector3(0, 2, -10),
                        destination: 'mobArea',
                        color: new BABYLON.Color3(1.0, 0.3, 0.3), // Red portal
                        glowColor: new BABYLON.Color3(1.0, 0.5, 0.5)
                    }
                ]
            },
            mobArea: {
                name: 'Combat Zone',
                spawnEnemies: true,
                groundSize: 60,
                cameraHeight: 30,
                groundColor: new BABYLON.Color3(0.2, 0.6, 0.2), // Current green
                lighting: {
                    hemisphericIntensity: 0.7,
                    directionalIntensity: 0.5
                },
                // Timer settings
                duration: 600000, // 10 minutes in milliseconds
                returnPortalDelay: 2000, // Show return portal 2 seconds after timer ends
                // Future: area modifiers
                modifiers: {
                    enemyLevel: 1,
                    itemLevel: 1,
                    rarityBonus: 1.0,
                    experienceBonus: 1.0,
                    goldBonus: 1.0
                },
                portals: [] // Return portal spawns dynamically
            }
        };

        this.portals = [];
        this.areaTimer = null;
        this.areaTimerElapsed = 0;
        this.returnPortalSpawned = false;
    }

    initialize() {
        // Set up initial area (home base)
        this.transitionToArea('homeBase', false);
    }

    transitionToArea(areaName, animate = true) {
        const area = this.areas[areaName];
        if (!area) {
            console.error('Unknown area:', areaName);
            return;
        }

        console.log('Transitioning to area:', area.name);

        // Clean up current area
        this.cleanupArea();

        // Update current area
        this.currentArea = areaName;

        // Reset player position
        this.game.player.mesh.position = new BABYLON.Vector3(0, 1, 0);
        this.game.player.velocity = new BABYLON.Vector3(0, 0, 0);

        // Update scene for new area
        this.setupAreaScene(area);

        // Spawn portals for this area
        this.spawnPortals(area);

        // Handle area-specific logic
        if (areaName === 'mobArea') {
            this.startMobAreaTimer();
        } else if (areaName === 'homeBase') {
            this.stopMobAreaTimer();
        }

        // Show transition message
        this.game.ui.showWaveIndicator(`Entering ${area.name}`);

        // Animation effect
        if (animate) {
            this.playTransitionEffect();
        }
    }

    setupAreaScene(area) {
        const scene = this.game.scene;

        // Update ground
        if (this.game.sceneManager.ground) {
            this.game.sceneManager.ground.dispose();
        }

        const ground = BABYLON.MeshBuilder.CreateGround("ground", {
            width: area.groundSize,
            height: area.groundSize
        }, scene);

        const groundMaterial = new BABYLON.StandardMaterial("groundMat", scene);
        groundMaterial.diffuseColor = area.groundColor;
        groundMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        ground.material = groundMaterial;
        ground.receiveShadows = true;

        this.game.sceneManager.ground = ground;
        this.game.sceneManager.groundSize = area.groundSize;

        // Update lighting
        if (this.game.sceneManager.hemisphericLight) {
            this.game.sceneManager.hemisphericLight.intensity = area.lighting.hemisphericIntensity;
        }
        if (this.game.sceneManager.directionalLight) {
            this.game.sceneManager.directionalLight.intensity = area.lighting.directionalIntensity;
        }

        // Re-create tile markers for visual variety
        this.createTileMarkers(area.groundSize);
    }

    createTileMarkers(groundSize) {
        const scene = this.game.scene;
        const tileSize = 3;
        const numTiles = 15;

        for (let i = 0; i < numTiles; i++) {
            const x = (Math.random() - 0.5) * groundSize * 0.8;
            const z = (Math.random() - 0.5) * groundSize * 0.8;

            const tile = BABYLON.MeshBuilder.CreateBox(`tile_${i}`, {
                width: tileSize,
                height: 0.1,
                depth: tileSize
            }, scene);

            tile.position = new BABYLON.Vector3(x, 0.2, z);

            const tileMat = new BABYLON.StandardMaterial(`tileMat_${i}`, scene);
            tileMat.diffuseColor = new BABYLON.Color3(
                Math.random() * 0.2 + 0.15,
                Math.random() * 0.2 + 0.45,
                Math.random() * 0.2 + 0.15
            );
            tileMat.disableDepthWrite = true; // Prevent Z-fighting
            tile.material = tileMat;
            tile.renderingGroupId = 1; // Render after opaque objects
        }
    }

    spawnPortals(area) {
        // Clean up existing portals
        this.portals.forEach(portal => portal.dispose());
        this.portals = [];

        // Spawn area portals
        if (area.portals && area.portals.length > 0) {
            area.portals.forEach(portalConfig => {
                const portal = new Portal(
                    this.game.scene,
                    portalConfig.position,
                    portalConfig.destination,
                    {
                        color: portalConfig.color,
                        glowColor: portalConfig.glowColor
                    }
                );
                this.portals.push(portal);
            });
        }
    }

    startMobAreaTimer() {
        this.areaTimerElapsed = 0;
        this.returnPortalSpawned = false;
        this.areaTimer = Date.now();

        // Enable spawning
        if (this.game.spawnManager) {
            this.game.spawnManager.canSpawn = true;
        }

        console.log('Started mob area timer: 10 minutes');
    }

    stopMobAreaTimer() {
        this.areaTimer = null;
        this.areaTimerElapsed = 0;
        this.returnPortalSpawned = false;

        // Disable spawning
        if (this.game.spawnManager) {
            this.game.spawnManager.canSpawn = false;
        }
    }

    updateMobAreaTimer(deltaTime) {
        if (this.currentArea !== 'mobArea' || !this.areaTimer) return;

        this.areaTimerElapsed += deltaTime;
        const area = this.areas.mobArea;

        // Check if timer has expired
        if (this.areaTimerElapsed >= area.duration) {
            // Stop spawning
            if (this.game.spawnManager && this.game.spawnManager.canSpawn) {
                this.game.spawnManager.canSpawn = false;
                console.log('Mob area timer expired - spawning stopped');
                this.game.ui.showWaveIndicator('Time\'s up! Return portal appearing...');
            }

            // Spawn return portal after delay
            if (!this.returnPortalSpawned && this.areaTimerElapsed >= area.duration + area.returnPortalDelay) {
                this.spawnReturnPortal();
            }
        }
    }

    spawnReturnPortal() {
        console.log('Spawning return portal');
        this.returnPortalSpawned = true;

        // Spawn portal at a safe location
        const portal = new Portal(
            this.game.scene,
            new BABYLON.Vector3(0, 2, 0), // Center of map
            'homeBase',
            {
                radius: 2.5,
                height: 5,
                color: new BABYLON.Color3(0.3, 1.0, 0.3), // Green portal
                glowColor: new BABYLON.Color3(0.5, 1.0, 0.5)
            }
        );

        this.portals.push(portal);
        this.game.ui.showWaveIndicator('Return portal opened!');
    }

    getRemainingTime() {
        if (this.currentArea !== 'mobArea' || !this.areaTimer) return 0;

        const area = this.areas.mobArea;
        return Math.max(0, area.duration - this.areaTimerElapsed);
    }

    update(deltaTime) {
        // Update portals
        this.portals.forEach(portal => portal.update(deltaTime));

        // Check portal interactions
        this.checkPortalInteractions();

        // Update mob area timer
        this.updateMobAreaTimer(deltaTime);
    }

    checkPortalInteractions() {
        const playerPos = this.game.player.mesh.position;

        this.portals.forEach(portal => {
            if (portal.checkPlayerInteraction(playerPos)) {
                // Show interaction hint (you can enhance this with UI)
                if (!portal.interactionHintShown) {
                    console.log(`Near portal to ${portal.destination}`);
                    portal.interactionHintShown = true;
                }

                // Auto-transition when player is very close (or you can add a key press)
                const distance = BABYLON.Vector3.Distance(playerPos, portal.position);
                if (distance < 1.5) {
                    this.transitionToArea(portal.destination);
                }
            } else {
                portal.interactionHintShown = false;
            }
        });
    }

    playTransitionEffect() {
        // Create a flash effect
        const flash = document.createElement('div');
        flash.style.position = 'fixed';
        flash.style.top = '0';
        flash.style.left = '0';
        flash.style.width = '100%';
        flash.style.height = '100%';
        flash.style.backgroundColor = 'white';
        flash.style.opacity = '0.8';
        flash.style.pointerEvents = 'none';
        flash.style.zIndex = '9999';
        flash.style.transition = 'opacity 0.5s';
        document.body.appendChild(flash);

        setTimeout(() => {
            flash.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(flash);
            }, 500);
        }, 100);
    }

    cleanupArea() {
        // Clear original decorative tiles from scene initialization
        if (this.game.sceneManager && this.game.sceneManager.cleanupDecorativeTiles) {
            this.game.sceneManager.cleanupDecorativeTiles();
        }

        // Clear all enemies
        if (this.game.enemies) {
            this.game.enemies.forEach(enemy => {
                if (enemy.mesh) enemy.mesh.dispose();
                if (enemy.healthBar) enemy.healthBar.dispose();
            });
            this.game.enemies = [];
        }

        // Clear all projectiles
        if (this.game.projectileManager) {
            this.game.projectileManager.projectiles.forEach(proj => {
                if (proj.mesh) proj.mesh.dispose();
            });
            this.game.projectileManager.projectiles = [];
        }

        // Clear all pickups
        if (this.game.pickupManager) {
            this.game.pickupManager.pickups.forEach(pickup => {
                if (pickup.mesh) pickup.mesh.dispose();
            });
            this.game.pickupManager.pickups = [];
        }

        // Clear portals
        this.portals.forEach(portal => portal.dispose());
        this.portals = [];
    }

    getCurrentArea() {
        return this.areas[this.currentArea];
    }

    isInCombatArea() {
        return this.currentArea === 'mobArea';
    }
}
