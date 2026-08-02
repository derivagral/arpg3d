/**
 * Stash - Interactive home-base container for stored gear.
 *
 * Deliberately reads as a different KIND of object from a portal: a portal is
 * a tall red cylinder that sends you into combat, the stash is a squat blue
 * chest that never moves you anywhere. Colour, silhouette, and prompt text all
 * differ so there is no chance of walking into a fight while looking for gear.
 *
 * Interaction is proximity-based like portals, but the stash requires a key
 * press rather than auto-triggering on contact — walking past your storage
 * should never yank you into a menu.
 */
class Stash {
    constructor(scene, position, config = {}) {
        this.scene = scene;
        this.position = position;
        this.config = {
            color: config.color || new BABYLON.Color3(0.25, 0.55, 1.0),      // blue
            glowColor: config.glowColor || new BABYLON.Color3(0.5, 0.8, 1.0),
            interactionRange: config.interactionRange || 3.5,
            label: config.label || 'Stash',
            hint: config.hint || 'Press E — store and equip gear',
            ...config
        };

        this.meshes = [];
        this.time = 0;
        this.playerInRange = false;

        this.createMesh();
    }

    createMesh() {
        // Chest body — wide and low, the opposite silhouette to a portal
        this.mesh = BABYLON.MeshBuilder.CreateBox('stashBody', {
            width: 2.4, height: 1.1, depth: 1.5
        }, this.scene);
        this.mesh.position = this.position.clone();

        const bodyMat = new BABYLON.StandardMaterial('stashBodyMat', this.scene);
        bodyMat.diffuseColor = new BABYLON.Color3(0.12, 0.2, 0.35);
        bodyMat.emissiveColor = this.config.color.scale(0.35);
        bodyMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.25);
        this.mesh.material = bodyMat;
        this.mesh.enableEdgesRendering();
        this.mesh.edgesWidth = 3.0;
        this.mesh.edgesColor = new BABYLON.Color4(
            this.config.glowColor.r, this.config.glowColor.g, this.config.glowColor.b, 1
        );
        this.meshes.push(this.mesh);

        // Lid band, so it reads as a container rather than a crate
        this.lid = BABYLON.MeshBuilder.CreateBox('stashLid', {
            width: 2.5, height: 0.25, depth: 1.6
        }, this.scene);
        this.lid.position = this.position.add(new BABYLON.Vector3(0, 0.68, 0));
        const lidMat = new BABYLON.StandardMaterial('stashLidMat', this.scene);
        lidMat.diffuseColor = new BABYLON.Color3(0.18, 0.3, 0.5);
        lidMat.emissiveColor = this.config.color.scale(0.5);
        this.lid.material = lidMat;
        this.meshes.push(this.lid);

        // Floating beacon — visible across the base, pulses gently
        this.beacon = BABYLON.MeshBuilder.CreateSphere('stashBeacon', {
            diameter: 0.5
        }, this.scene);
        this.beacon.position = this.position.add(new BABYLON.Vector3(0, 2.2, 0));
        const beaconMat = new BABYLON.StandardMaterial('stashBeaconMat', this.scene);
        beaconMat.emissiveColor = this.config.glowColor;
        beaconMat.diffuseColor = this.config.color;
        this.beacon.material = beaconMat;
        this.meshes.push(this.beacon);

        if (!this.scene.glowLayer) {
            this.scene.glowLayer = new BABYLON.GlowLayer('glow', this.scene);
        }
        this.scene.glowLayer.addIncludedOnlyMesh(this.lid);
        this.scene.glowLayer.addIncludedOnlyMesh(this.beacon);

        // Ground ring marks the interaction radius, same idea as portal markers
        this.marker = BABYLON.MeshBuilder.CreateDisc('stashMarker', {
            radius: this.config.interactionRange, tessellation: 48
        }, this.scene);
        this.marker.rotation.x = Math.PI / 2;
        this.marker.position = new BABYLON.Vector3(this.position.x, 0.06, this.position.z);
        const markerMat = new BABYLON.StandardMaterial('stashMarkerMat', this.scene);
        markerMat.emissiveColor = this.config.color.scale(0.5);
        markerMat.alpha = 0.18;
        markerMat.backFaceCulling = false;
        this.marker.material = markerMat;
        this.meshes.push(this.marker);
    }

    update(deltaTime) {
        this.time += deltaTime || 16;
        if (this.beacon) {
            this.beacon.position.y = this.position.y + 2.2 + Math.sin(this.time / 400) * 0.18;
            this.beacon.rotation.y += 0.02;
        }
    }

    /** @returns {boolean} true when the player stands inside the interaction ring */
    checkPlayerInteraction(playerPos) {
        const distance = BABYLON.Vector3.Distance(playerPos, this.position);
        this.playerInRange = distance <= this.config.interactionRange;
        return this.playerInRange;
    }

    dispose() {
        this.meshes.forEach(m => { if (m) m.dispose(); });
        this.meshes = [];
        this.mesh = null;
    }
}
