/**
 * Marker - A non-interactive, in-map objective/shrine object.
 *
 * Unlike Portal (which travels the player between areas), a Marker just sits in
 * the world and reacts to the player's presence via an area check. It has no
 * behaviour of its own — MarkerManager reads its config and drives the rules.
 * The Marker only owns its visuals and a small state machine for feedback:
 *
 *   idle -> active (player inside / objective running) -> success | fail | spent
 */
class Marker {
    constructor(scene, position, config) {
        this.scene = scene;
        this.position = position; // BABYLON.Vector3 (ground level)
        this.config = config;
        this.def = config; // alias used by MarkerManager
        this.radius = config.radius || 4;

        this.state = 'idle';
        this.inside = false; // player currently within radius?
        this.fired = false;  // one-shot triggers latch this
        this.time = 0;
        this.meshes = [];

        this.baseColor = Marker.toColor3(config.color || [1, 1, 1]);
        this.glowColor = Marker.toColor3(config.glowColor || config.color || [1, 1, 1]);

        this.createVisual();
    }

    static toColor3(c) {
        if (c instanceof BABYLON.Color3) return c;
        return new BABYLON.Color3(c[0], c[1], c[2]);
    }

    createVisual() {
        const id = this.config.id;

        // Ensure a shared glow layer exists (Portal uses the same one).
        if (!this.scene.glowLayer) {
            this.scene.glowLayer = new BABYLON.GlowLayer('glow', this.scene);
        }

        // Floating core crystal
        const core = BABYLON.MeshBuilder.CreatePolyhedron('marker_' + id, {
            type: 1, size: 0.8
        }, this.scene);
        core.position = new BABYLON.Vector3(this.position.x, 2, this.position.z);

        const coreMat = new BABYLON.StandardMaterial('markerMat_' + id, this.scene);
        coreMat.emissiveColor = this.baseColor;
        coreMat.diffuseColor = this.baseColor;
        core.material = coreMat;
        this.scene.glowLayer.addIncludedOnlyMesh(core);

        this.core = core;
        this.coreMat = coreMat;
        this.meshes.push(core);

        // Ground ring showing the trigger radius
        const ring = BABYLON.MeshBuilder.CreateTorus('markerRing_' + id, {
            diameter: this.radius * 2,
            thickness: 0.15,
            tessellation: 48
        }, this.scene);
        ring.position = new BABYLON.Vector3(this.position.x, 0.3, this.position.z);
        ring.rotation.x = Math.PI / 2;

        const ringMat = new BABYLON.StandardMaterial('markerRingMat_' + id, this.scene);
        ringMat.emissiveColor = this.glowColor;
        ringMat.alpha = 0.5;
        ringMat.disableDepthWrite = true; // avoid Z-fighting with the ground
        ring.material = ringMat;
        ring.renderingGroupId = 1;
        this.scene.glowLayer.addIncludedOnlyMesh(ring);

        this.ring = ring;
        this.ringMat = ringMat;
        this.meshes.push(ring);
    }

    setState(state) {
        this.state = state;
        const palette = {
            idle: this.baseColor,
            active: this.glowColor,
            success: new BABYLON.Color3(0.2, 1.0, 0.3),
            fail: new BABYLON.Color3(0.6, 0.1, 0.1),
            spent: new BABYLON.Color3(0.3, 0.3, 0.3)
        };
        const c = palette[state] || this.baseColor;
        this.coreMat.emissiveColor = c;
        this.ringMat.emissiveColor = c;
        this.ringMat.alpha = (state === 'spent') ? 0.15 : 0.5;
    }

    isPlayerInside(playerPosition) {
        const dx = playerPosition.x - this.position.x;
        const dz = playerPosition.z - this.position.z;
        return (dx * dx + dz * dz) <= this.radius * this.radius;
    }

    update(deltaTime) {
        this.time += deltaTime;
        // Bob + spin the core; slowly rotate the ring.
        this.core.rotation.y += 0.01;
        this.core.position.y = 2 + Math.sin(this.time * 0.003) * 0.3;
        this.ring.rotation.z += 0.005;
    }

    dispose() {
        this.meshes.forEach(m => m.dispose());
        this.meshes = [];
    }
}

// Export for Node-based use/tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Marker;
}
