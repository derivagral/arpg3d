// Attack Indicator Manager - Visual telegraphs for enemy attacks
class AttackIndicatorManager {
    constructor(scene) {
        this.scene = scene;
        this.indicators = [];
    }

    createAOEIndicator(position, radius, durationMs, color, onComplete) {
        const col = color || CONFIG.indicators.aoe.fillColor;
        const c3 = new BABYLON.Color3(col[0], col[1], col[2]);

        // Outer border ring
        const border = BABYLON.MeshBuilder.CreateTorus(
            'aoe_border',
            { diameter: radius * 2, thickness: 0.12, tessellation: 32 },
            this.scene
        );
        border.position = new BABYLON.Vector3(position.x, 0.05, position.z);
        border.rotation.x = 0;
        const borderMat = new BABYLON.StandardMaterial('aoe_borderMat', this.scene);
        const borderCol = CONFIG.indicators.aoe.borderColor;
        borderMat.diffuseColor = new BABYLON.Color3(borderCol[0], borderCol[1], borderCol[2]);
        borderMat.emissiveColor = borderMat.diffuseColor.scale(0.5);
        borderMat.alpha = CONFIG.indicators.aoe.borderAlpha;
        borderMat.disableDepthWrite = true;
        border.material = borderMat;
        border.renderingGroupId = 1;

        // Inner fill disc — starts at scale 0, grows to fill the radius
        const fill = BABYLON.MeshBuilder.CreateDisc(
            'aoe_fill',
            { radius: radius, tessellation: 32 },
            this.scene
        );
        fill.position = new BABYLON.Vector3(position.x, 0.04, position.z);
        fill.rotation.x = Math.PI / 2;
        const fillMat = new BABYLON.StandardMaterial('aoe_fillMat', this.scene);
        fillMat.diffuseColor = c3;
        fillMat.emissiveColor = c3.scale(0.3);
        fillMat.alpha = CONFIG.indicators.aoe.alpha;
        fillMat.disableDepthWrite = true;
        fillMat.backFaceCulling = false;
        fill.material = fillMat;
        fill.renderingGroupId = 1;
        fill.scaling = new BABYLON.Vector3(0.01, 0.01, 0.01);

        const indicator = {
            type: 'aoe',
            meshes: [border, fill],
            fillMesh: fill,
            borderMesh: border,
            startTime: Date.now(),
            duration: durationMs,
            onComplete: onComplete || null,
            completed: false,
            disposed: false,
            flashUntil: 0
        };

        this.indicators.push(indicator);
        return indicator;
    }

    createLineIndicator(from, to, width, durationMs, color) {
        const col = color || CONFIG.indicators.line.color;
        const c3 = new BABYLON.Color3(col[0], col[1], col[2]);
        const w = width || CONFIG.indicators.line.width;

        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const length = Math.sqrt(dx * dx + dz * dz);
        const angle = Math.atan2(dx, dz);

        const midX = (from.x + to.x) / 2;
        const midZ = (from.z + to.z) / 2;

        const line = BABYLON.MeshBuilder.CreateBox(
            'line_indicator',
            { width: w, height: 0.02, depth: length },
            this.scene
        );
        line.position = new BABYLON.Vector3(midX, 0.05, midZ);
        line.rotation.y = angle;

        const lineMat = new BABYLON.StandardMaterial('line_mat', this.scene);
        lineMat.diffuseColor = c3;
        lineMat.emissiveColor = c3.scale(0.5);
        lineMat.alpha = 0;
        lineMat.disableDepthWrite = true;
        line.material = lineMat;
        line.renderingGroupId = 1;

        const indicator = {
            type: 'line',
            meshes: [line],
            lineMesh: line,
            startTime: Date.now(),
            duration: durationMs,
            completed: false,
            disposed: false
        };

        this.indicators.push(indicator);
        return indicator;
    }

    createProjectilePath(from, direction, length, durationMs, color) {
        if (!CONFIG.indicators.enabled) return null;

        const col = color || CONFIG.indicators.projectilePath.color;
        const c3 = new BABYLON.Color3(col[0], col[1], col[2]);
        const segCount = CONFIG.indicators.projectilePath.segmentCount;
        const segLen = length / segCount;
        const meshes = [];

        const dir = direction.normalize();

        for (let i = 0; i < segCount; i++) {
            // Dashed: only draw even segments
            if (i % 2 !== 0) continue;

            const t = (i + 0.5) * segLen;
            const seg = BABYLON.MeshBuilder.CreateBox(
                'proj_path_seg',
                { width: 0.1, height: 0.01, depth: segLen * 0.7 },
                this.scene
            );
            seg.position = new BABYLON.Vector3(
                from.x + dir.x * t,
                0.05,
                from.z + dir.z * t
            );
            seg.rotation.y = Math.atan2(dir.x, dir.z);

            const segMat = new BABYLON.StandardMaterial('proj_path_mat', this.scene);
            segMat.diffuseColor = c3;
            segMat.emissiveColor = c3.scale(0.3);
            segMat.alpha = CONFIG.indicators.projectilePath.alpha;
            segMat.disableDepthWrite = true;
            seg.material = segMat;
            seg.renderingGroupId = 1;

            meshes.push(seg);
        }

        const indicator = {
            type: 'projectilePath',
            meshes: meshes,
            startTime: Date.now(),
            duration: durationMs || 500,
            completed: false,
            disposed: false
        };

        this.indicators.push(indicator);
        return indicator;
    }

    update() {
        const now = Date.now();

        this.indicators = this.indicators.filter(ind => {
            // Already disposed by a previous cycle — remove from array
            if (ind.disposed) return false;

            const elapsed = now - ind.startTime;
            const progress = Math.min(1, elapsed / ind.duration);

            // AOE flash phase — wait for flash to finish, then dispose
            if (ind.completed && ind.type === 'aoe') {
                if (now >= ind.flashUntil) {
                    this.disposeMeshes(ind);
                    return false;
                }
                return true; // Still flashing
            }

            // Already completed (non-AOE types dispose immediately)
            if (ind.completed) return false;

            if (ind.type === 'aoe') {
                if (!ind.fillMesh.isDisposed()) {
                    const s = progress;
                    ind.fillMesh.scaling = new BABYLON.Vector3(s, s, s);
                }
                if (!ind.borderMesh.isDisposed()) {
                    const pulse = 0.5 + Math.sin(elapsed * 0.01) * 0.2;
                    ind.borderMesh.material.alpha = CONFIG.indicators.aoe.borderAlpha * pulse;
                }
            }

            if (ind.type === 'line') {
                if (!ind.lineMesh.isDisposed()) {
                    let alpha = CONFIG.indicators.line.alpha;
                    if (progress < 0.3) {
                        alpha *= progress / 0.3;
                    } else if (progress > 0.8) {
                        alpha *= (1 - progress) / 0.2;
                    }
                    ind.lineMesh.material.alpha = alpha;
                }
            }

            if (ind.type === 'projectilePath') {
                const alpha = CONFIG.indicators.projectilePath.alpha * (1 - progress);
                ind.meshes.forEach(m => {
                    if (m.material && !m.isDisposed()) m.material.alpha = alpha;
                });
            }

            // Completion
            if (progress >= 1) {
                ind.completed = true;

                if (ind.onComplete) ind.onComplete();

                if (ind.type === 'aoe') {
                    // Flash: bright white for 150ms, then dispose next cycle
                    if (!ind.fillMesh.isDisposed()) {
                        ind.fillMesh.material.alpha = 0.5;
                        ind.fillMesh.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
                    }
                    ind.flashUntil = now + 150;
                    return true;
                }

                // Non-AOE: dispose immediately
                this.disposeMeshes(ind);
                return false;
            }

            return true;
        });
    }

    disposeMeshes(indicator) {
        indicator.disposed = true;
        indicator.meshes.forEach(m => {
            if (m && !m.isDisposed()) m.dispose();
        });
    }

    clear() {
        this.indicators.forEach(ind => {
            ind.meshes.forEach(m => {
                if (m && !m.isDisposed()) m.dispose();
            });
        });
        this.indicators = [];
    }
}
