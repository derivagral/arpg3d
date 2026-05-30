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

        // Floating name label so the player can tell markers apart at a glance.
        this.createLabel(this.config.name || id);
    }

    createLabel(text) {
        const id = this.config.id;
        const plane = BABYLON.MeshBuilder.CreatePlane('markerLabel_' + id, {
            width: 6, height: 1.5
        }, this.scene);
        plane.position = new BABYLON.Vector3(this.position.x, 4, this.position.z);
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        plane.isPickable = false;

        const dt = new BABYLON.DynamicTexture('markerLabelTex_' + id, {
            width: 512, height: 128
        }, this.scene, true);
        dt.hasAlpha = true;
        dt.drawText(text, null, 88, 'bold 60px sans-serif', '#ffffff', 'transparent', true);

        const mat = new BABYLON.StandardMaterial('markerLabelMat_' + id, this.scene);
        mat.diffuseTexture = dt;
        mat.opacityTexture = dt;
        mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        plane.material = mat;
        plane.renderingGroupId = 1;

        this.label = plane;
        this.meshes.push(plane);
    }

    // ── Reusable fill primitive ────────────────────────────────────────
    // A flat disc inside the ring that grows from the center (0) to the full
    // radius (1). Used to visualise any countdown/charge — objective arming,
    // the objective timer, and (later) telegraphed attacks or events.

    ensureFill() {
        if (this.fillMesh) return;
        const id = this.config.id;

        // Expanding/contracting disc — the actual "fill".
        const fill = BABYLON.MeshBuilder.CreateCylinder('markerFill_' + id, {
            height: 0.04,
            diameter: this.radius * 2,
            tessellation: 48
        }, this.scene);
        fill.position = new BABYLON.Vector3(this.position.x, 0.25, this.position.z);
        fill.isPickable = false;

        const mat = new BABYLON.StandardMaterial('markerFillMat_' + id, this.scene);
        mat.emissiveColor = this.glowColor;
        mat.alpha = 0.3;
        mat.disableDepthWrite = true;
        fill.material = mat;
        fill.renderingGroupId = 1;

        this.fillMesh = fill;
        this.fillMat = mat;
        this.meshes.push(fill);

        // Target outline — a bright ring marking the radius the fill is heading
        // toward. Stays put while the disc grows (charge) or drains (timer), so
        // the player can read the final extent and any safe gap inside it.
        const outline = BABYLON.MeshBuilder.CreateTorus('markerFillOutline_' + id, {
            diameter: this.radius * 2,
            thickness: 0.12,
            tessellation: 64
        }, this.scene);
        outline.position = new BABYLON.Vector3(this.position.x, 0.4, this.position.z);
        outline.rotation.x = Math.PI / 2;
        outline.isPickable = false;

        const oMat = new BABYLON.StandardMaterial('markerFillOutlineMat_' + id, this.scene);
        oMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        oMat.alpha = 0.85;
        oMat.disableDepthWrite = true;
        outline.material = oMat;
        outline.renderingGroupId = 1;
        this.scene.glowLayer.addIncludedOnlyMesh(outline);

        this.fillOutline = outline;
        this.fillOutlineMat = oMat;
        this.meshes.push(outline);

        fill.setEnabled(false);
        outline.setEnabled(false);
    }

    // progress: 0..1 (fraction of the disc that's filled). color optional.
    // The target outline is shown for the whole effect; the disc grows/drains.
    setFill(progress, color) {
        this.ensureFill();
        const p = Math.max(0, Math.min(1, progress));
        this.fillMesh.setEnabled(p > 0);
        this.fillMesh.scaling.x = p;
        this.fillMesh.scaling.z = p;
        this.fillOutline.setEnabled(true);
        if (color) this.fillMat.emissiveColor = color;
    }

    clearFill() {
        if (this.fillMesh) this.fillMesh.setEnabled(false);
        if (this.fillOutline) this.fillOutline.setEnabled(false);
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

        // Pulse the target outline while a fill is active so it reads as "live".
        if (this.fillOutline && this.fillOutline.isEnabled()) {
            this.fillOutlineMat.alpha = 0.7 + Math.sin(this.time * 0.006) * 0.18;
        }
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
