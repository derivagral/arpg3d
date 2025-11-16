/**
 * Portal - Interactive portal for area transitions
 */
class Portal {
    constructor(scene, position, destination, config = {}) {
        this.scene = scene;
        this.position = position;
        this.destination = destination; // 'mobArea' or 'homeBase'
        this.config = {
            radius: config.radius || 2,
            height: config.height || 4,
            color: config.color || new BABYLON.Color3(0.3, 0.6, 1.0),
            glowColor: config.glowColor || new BABYLON.Color3(0.5, 0.8, 1.0),
            interactionRange: config.interactionRange || 3,
            ...config
        };

        this.mesh = null;
        this.glowLayer = null;
        this.isActive = true;
        this.rotationSpeed = 0.01;
        this.pulseSpeed = 0.05;
        this.time = 0;

        this.createPortal();
    }

    createPortal() {
        // Main portal cylinder
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("portal_" + this.destination, {
            height: this.config.height,
            diameter: this.config.radius * 2,
            tessellation: 32
        }, this.scene);

        this.mesh.position = this.position.clone();

        // Create swirling portal material
        const material = new BABYLON.StandardMaterial("portalMat_" + this.destination, this.scene);
        material.emissiveColor = this.config.color;
        material.alpha = 0.7;
        material.backFaceCulling = false;
        this.mesh.material = material;

        // Add glow effect
        if (!this.scene.glowLayer) {
            this.scene.glowLayer = new BABYLON.GlowLayer("glow", this.scene);
        }
        this.scene.glowLayer.addIncludedOnlyMesh(this.mesh);

        // Create inner swirl effect
        this.innerSwirl = BABYLON.MeshBuilder.CreateCylinder("portalSwirl_" + this.destination, {
            height: this.config.height * 0.9,
            diameter: this.config.radius * 1.5,
            tessellation: 32
        }, this.scene);

        this.innerSwirl.position = this.position.clone();
        const swirlMat = new BABYLON.StandardMaterial("swirlMat_" + this.destination, this.scene);
        swirlMat.emissiveColor = this.config.glowColor;
        swirlMat.alpha = 0.4;
        swirlMat.backFaceCulling = false;
        this.innerSwirl.material = swirlMat;
        this.scene.glowLayer.addIncludedOnlyMesh(this.innerSwirl);

        // Create particle effect
        this.createParticles();

        // Create ground marker
        this.createGroundMarker();
    }

    createParticles() {
        const particleSystem = new BABYLON.ParticleSystem("portalParticles_" + this.destination, 200, this.scene);

        // Create procedural flare texture
        particleSystem.particleTexture = this.createFlareTexture();

        // Emitter
        particleSystem.emitter = this.position.clone();
        particleSystem.minEmitBox = new BABYLON.Vector3(-this.config.radius, 0, -this.config.radius);
        particleSystem.maxEmitBox = new BABYLON.Vector3(this.config.radius, this.config.height, this.config.radius);

        // Colors
        particleSystem.color1 = new BABYLON.Color4(this.config.color.r, this.config.color.g, this.config.color.b, 1.0);
        particleSystem.color2 = new BABYLON.Color4(this.config.glowColor.r, this.config.glowColor.g, this.config.glowColor.b, 1.0);
        particleSystem.colorDead = new BABYLON.Color4(0, 0, 0, 0.0);

        // Size
        particleSystem.minSize = 0.1;
        particleSystem.maxSize = 0.3;

        // Life time
        particleSystem.minLifeTime = 0.5;
        particleSystem.maxLifeTime = 1.5;

        // Emission rate
        particleSystem.emitRate = 50;

        // Blend mode
        particleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;

        // Direction
        particleSystem.direction1 = new BABYLON.Vector3(-0.5, 1, -0.5);
        particleSystem.direction2 = new BABYLON.Vector3(0.5, 2, 0.5);

        // Speed
        particleSystem.minEmitPower = 0.5;
        particleSystem.maxEmitPower = 1.5;
        particleSystem.updateSpeed = 0.01;

        particleSystem.start();
        this.particleSystem = particleSystem;
    }

    createFlareTexture() {
        // Create a procedural flare texture for particles
        const textureSize = 128;
        const dynamicTexture = new BABYLON.DynamicTexture(
            "flareTexture_" + this.destination,
            textureSize,
            this.scene,
            false
        );

        const context = dynamicTexture.getContext();
        const centerX = textureSize / 2;
        const centerY = textureSize / 2;
        const radius = textureSize / 2;

        // Create radial gradient
        const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        context.fillStyle = gradient;
        context.fillRect(0, 0, textureSize, textureSize);

        dynamicTexture.update();
        return dynamicTexture;
    }

    createGroundMarker() {
        // Create a glowing ring on the ground
        const ring = BABYLON.MeshBuilder.CreateTorus("portalRing_" + this.destination, {
            diameter: this.config.radius * 2.5,
            thickness: 0.2,
            tessellation: 32
        }, this.scene);

        ring.position = new BABYLON.Vector3(this.position.x, 0.35, this.position.z);
        ring.rotation.x = Math.PI / 2;

        const ringMat = new BABYLON.StandardMaterial("ringMat_" + this.destination, this.scene);
        ringMat.emissiveColor = this.config.glowColor;
        ringMat.alpha = 0.6;
        ringMat.disableDepthWrite = true; // Prevent Z-fighting with transparent materials
        ring.material = ringMat;
        ring.renderingGroupId = 1; // Render after opaque objects
        this.scene.glowLayer.addIncludedOnlyMesh(ring);

        this.groundRing = ring;
    }

    update(deltaTime) {
        if (!this.isActive) return;

        this.time += deltaTime;

        // Rotate portal
        this.mesh.rotation.y += this.rotationSpeed;
        this.innerSwirl.rotation.y -= this.rotationSpeed * 1.5;

        // Pulse effect
        const pulse = Math.sin(this.time * this.pulseSpeed) * 0.1 + 1.0;
        this.mesh.scaling.y = pulse;
        this.innerSwirl.scaling.x = pulse * 0.9;
        this.innerSwirl.scaling.z = pulse * 0.9;

        // Rotate ground ring
        this.groundRing.rotation.z += this.rotationSpeed * 0.5;
    }

    checkPlayerInteraction(playerPosition) {
        if (!this.isActive) return false;

        const distance = BABYLON.Vector3.Distance(playerPosition, this.position);
        return distance <= this.config.interactionRange;
    }

    setActive(active) {
        this.isActive = active;
        this.mesh.setEnabled(active);
        this.innerSwirl.setEnabled(active);
        this.groundRing.setEnabled(active);

        if (active) {
            this.particleSystem.start();
        } else {
            this.particleSystem.stop();
        }
    }

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
        }
        if (this.innerSwirl) {
            this.innerSwirl.dispose();
        }
        if (this.groundRing) {
            this.groundRing.dispose();
        }
        if (this.particleSystem) {
            this.particleSystem.dispose();
        }
    }
}
