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
                groundSize: 46,   // +15%
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
                        glowColor: new BABYLON.Color3(1.0, 0.5, 0.5),
                        label: 'Combat Zone',
                        hint: 'Walk in to start a run'
                    }
                ],
                // Placed opposite the combat portal (+z vs -z) so gear and
                // "start a fight" are never adjacent by accident.
                stash: {
                    position: new BABYLON.Vector3(0, 0.75, 10),
                    color: new BABYLON.Color3(0.25, 0.55, 1.0),      // blue, vs the red portal
                    glowColor: new BABYLON.Color3(0.5, 0.8, 1.0),
                    label: 'Armory',
                    hint: 'Press E — store loot and set your loadout'
                }
            },
            mobArea: {
                name: 'Combat Zone',
                spawnEnemies: true,
                groundSize: 69,   // +15% — mirrors ARENA_RADIUS in sim/movement.js
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
        this.stash = null;
        // Key of whatever the interaction prompt is currently showing, or null.
        this.activePrompt = null;
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

        // Spawn portals and home-base fixtures for this area
        this.spawnPortals(area);
        this.spawnStash(area);

        // Handle area-specific logic
        if (areaName === 'mobArea') {
            this.startMobAreaTimer();
            // Spawn fresh in-map objective markers each time we enter (refresh per entry).
            if (this.game.markerManager) {
                this.game.markerManager.spawn('mobArea');
            }
        } else if (areaName === 'homeBase') {
            this.stopMobAreaTimer();
        }

        // Tell the host, which binds the sim run's lifecycle to this: entering
        // the combat zone starts a run, returning home ends it. That mapping is
        // what makes "your loadout is fixed for the run" a coherent rule —
        // home base is the only place gear can change, and it is a real place.
        if (this.game.onAreaChanged) this.game.onAreaChanged(areaName);

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
        // Player clamping reads this; without it the bounds stayed on the
        // global CONFIG.world default and the smaller home base wasn't
        // enclosed at all.
        this.game.currentGroundSize = area.groundSize;

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

        // Track every mesh we create so cleanupArea() can dispose it — previously
        // these tiles were untracked and leaked on every area transition.
        this.areaTiles = [];

        // Build one decorative tile. Height, vertical offset, and rotation are
        // jittered so overlapping tiles don't share a coplanar top face (which
        // caused z-fighting flicker), and edge outlines make them read as
        // deliberate pads rather than flat green squares — no textures needed.
        const makeTile = (x, z, size) => {
            const idx = this.areaTiles.length;
            const height = 0.12 + Math.random() * 0.14;
            const tile = BABYLON.MeshBuilder.CreateBox(`tile_${idx}`, {
                width: size, height, depth: size
            }, scene);
            tile.position = new BABYLON.Vector3(x, 0.12 + Math.random() * 0.16, z);
            tile.rotation.y = Math.random() * Math.PI;

            const tileMat = new BABYLON.StandardMaterial(`tileMat_${idx}`, scene);
            tileMat.diffuseColor = new BABYLON.Color3(
                Math.random() * 0.15 + 0.15,
                Math.random() * 0.18 + 0.40,
                Math.random() * 0.15 + 0.15
            );
            tileMat.specularColor = new BABYLON.Color3(0, 0, 0);
            tile.material = tileMat;

            tile.enableEdgesRendering();
            tile.edgesWidth = 2.0;
            tile.edgesColor = new BABYLON.Color4(0.1, 0.35, 0.18, 0.7);

            this.areaTiles.push(tile);
            return tile;
        };

        // The quadrant cross + clustered decoration only make sense in areas that
        // actually host objective markers. Other areas (home base) get a lighter,
        // marker-free scatter.
        const hasMarkers = !!(CONFIG.markers && CONFIG.markers.areas &&
                              CONFIG.markers.areas[this.currentArea]);

        if (!hasMarkers) {
            for (let i = 0; i < 10; i++) {
                makeTile(
                    (Math.random() - 0.5) * groundSize * 0.8,
                    (Math.random() - 0.5) * groundSize * 0.8,
                    3
                );
            }
            return;
        }

        // No quadrant cross: the explicit divider read as a UI overlay painted
        // on the ground rather than terrain, and it fought the objective
        // markers for attention. The per-quadrant clusters below already imply
        // the same four zones without drawing lines through the play space.

        // Sparse, deliberate decoration: a small cluster per quadrant rather than
        // random scatter across the whole map.
        const q = groundSize / 4;
        const quadCenters = [[q, q], [-q, q], [q, -q], [-q, -q]];
        quadCenters.forEach((center) => {
            for (let i = 0; i < 3; i++) {
                makeTile(
                    center[0] + (Math.random() - 0.5) * groundSize * 0.16,
                    center[1] + (Math.random() - 0.5) * groundSize * 0.16,
                    2
                );
            }
        });
    }

    spawnPortals(area) {
        // Clean up existing portals
        this.portals.forEach(portal => portal.dispose());
        this.portals = [];

        // Spawn area portals
        if (area.portals && area.portals.length > 0) {
            area.portals.forEach(portalConfig => {
                // Spread the whole config: picking out individual fields here
                // silently dropped label/hint, so prompts fell back to showing
                // the raw destination id ('mobArea').
                const portal = new Portal(
                    this.game.scene,
                    portalConfig.position,
                    portalConfig.destination,
                    { ...portalConfig }
                );
                this.portals.push(portal);
            });
        }
    }

    spawnStash(area) {
        if (this.stash) { this.stash.dispose(); this.stash = null; }
        if (!area.stash) return;
        this.stash = new Stash(this.game.scene, area.stash.position, area.stash);
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
                glowColor: new BABYLON.Color3(0.5, 1.0, 0.5),
                label: 'Home Base',
                hint: 'Walk in to return'
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

        // Update home-base stash
        if (this.stash) this.stash.update(deltaTime);

        // Prompt first, then interactions — a transition inside
        // checkPortalInteractions() disposes this area's portals, and the next
        // frame's reconcile is what clears the prompt.
        this.updateInteractionPrompt();
        this.checkPortalInteractions();

        // Update mob area timer
        this.updateMobAreaTimer(deltaTime);
    }

    checkPortalInteractions() {
        const playerPos = this.game.player.mesh.position;

        // Snapshot: transitionToArea() replaces this.portals mid-iteration.
        for (const portal of [...this.portals]) {
            if (!portal.checkPlayerInteraction(playerPos)) continue;
            if (BABYLON.Vector3.Distance(playerPos, portal.position) < 1.5) {
                this.transitionToArea(portal.destination);
                return;   // this area is gone; stop touching its portals
            }
        }
    }

    /**
     * Reconcile the world-interaction prompt from scratch each frame.
     *
     * Previously each portal/stash carried its own "prompt shown" flag and was
     * responsible for hiding it. Walking into a portal disposes every portal in
     * the area, so the object holding the flag disappeared before it could hide
     * anything and the prompt stranded on screen forever (visible as a
     * permanent 'mobArea' label after travelling). Deriving the prompt from
     * current world state instead means a source that vanishes simply stops
     * being found, and the prompt clears on its own.
     */
    updateInteractionPrompt() {
        const playerPos = this.game.player.mesh.position;
        let next = null;

        // Stash wins over portals: it needs a keypress, so if you're standing
        // in both you want to be told about the one that won't move you.
        if (this.stash && this.stash.checkPlayerInteraction(playerPos)) {
            next = {
                key: 'stash',
                label: this.stash.config.label,
                hint: this.stash.config.hint,
                color: '#7fb8ff'
            };
        } else {
            for (const portal of this.portals) {
                if (!portal.checkPlayerInteraction(playerPos)) continue;
                next = {
                    key: 'portal:' + portal.destination,
                    label: portal.config.label || portal.destination,
                    hint: portal.config.hint || 'Walk in to travel',
                    color: '#ff8a8a'
                };
                break;
            }
        }

        if (!next) {
            this.clearInteractionPrompt();
            return;
        }
        if (this.activePrompt !== next.key) {
            this.game.ui.showInteractionPrompt(next.label, next.hint, next.color);
            this.activePrompt = next.key;
        }
    }

    clearInteractionPrompt() {
        if (!this.activePrompt) return;
        this.activePrompt = null;
        if (this.game.ui && this.game.ui.hideInteractionPrompt) {
            this.game.ui.hideInteractionPrompt();
        }
    }

    /** True when the player is standing at the stash (used by the E key). */
    isAtStash() {
        return !!(this.stash && this.stash.playerInRange);
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

        // Clear per-area tiles (quadrant dividers + decoration) created in createTileMarkers
        if (this.areaTiles) {
            this.areaTiles.forEach(tile => tile.dispose());
            this.areaTiles = [];
        }

        // Tear down in-map markers (reverts any lingering buffs / spawn mods)
        if (this.game.markerManager) {
            this.game.markerManager.clear();
        }

        // Clear all enemies.
        //
        // This used to write `this.game.enemies = []`, but game.enemies is an
        // ALIAS captured once in the Game constructor — reassigning it left
        // game.state.enemies (what the loop actually iterates) untouched, so
        // the horde followed the player home, kept attacking, and kept
        // dropping orbs in the base. Mutate the real array in place.
        const enemies = this.game.state.enemies;
        if (enemies) {
            enemies.forEach(enemy => {
                if (enemy.mesh) enemy.mesh.dispose();
                if (enemy.healthBar) enemy.healthBar.dispose();
                if (enemy.dispose) enemy.dispose();
            });
            enemies.length = 0;          // in place: keeps every alias valid
        }
        this.game.simDropQueue.length = 0;   // drops belonged to that area

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

        // Clear home-base fixtures
        if (this.stash) { this.stash.dispose(); this.stash = null; }

        // Every prompt source in this area is now gone.
        this.clearInteractionPrompt();
    }

    getCurrentArea() {
        return this.areas[this.currentArea];
    }

    isInCombatArea() {
        return this.currentArea === 'mobArea';
    }
}
