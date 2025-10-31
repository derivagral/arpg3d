// Scene Manager
class SceneManager {
    constructor(engine) {
        this.engine = engine;
        this.scene = null;
        this.camera = null;

        this.initScene();
    }

    initScene() {
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color3(0.1, 0.1, 0.15);

        this.setupCamera();
        this.setupLights();
        this.createEnvironment();
    }

    setupCamera() {
        this.camera = new BABYLON.UniversalCamera(
            "camera",
            new BABYLON.Vector3(0, CONFIG.world.cameraHeight, -CONFIG.world.cameraOffset),
            this.scene
        );
        this.camera.setTarget(BABYLON.Vector3.Zero());
        this.camera.rotation.x = CONFIG.world.cameraAngle;
    }

    setupLights() {
        const ambient = new BABYLON.HemisphericLight(
            "ambient",
            new BABYLON.Vector3(0, 1, 0),
            this.scene
        );
        ambient.intensity = 0.7;

        const dirLight = new BABYLON.DirectionalLight(
            "dir",
            new BABYLON.Vector3(0.5, -1, 0.5),
            this.scene
        );
        dirLight.intensity = 0.5;
    }

    createEnvironment() {
        // Main ground
        const ground = BABYLON.MeshBuilder.CreateGround(
            "ground",
            {
                width: CONFIG.world.groundSize,
                height: CONFIG.world.groundSize,
                subdivisions: 20
            },
            this.scene
        );

        const groundMat = new BABYLON.StandardMaterial("groundMat", this.scene);
        groundMat.diffuseColor = new BABYLON.Color3(0.15, 0.25, 0.15);
        groundMat.specularColor = new BABYLON.Color3(0, 0, 0);
        ground.material = groundMat;

        // Add grid pattern for visual interest
        for (let i = 0; i < 15; i++) {
            const tile = BABYLON.MeshBuilder.CreateBox(
                "tile",
                {width: 3, height: 0.01, depth: 3},
                this.scene
            );
            tile.position.x = (Math.random() - 0.5) * 50;
            tile.position.z = (Math.random() - 0.5) * 50;
            tile.position.y = 0.01;

            const tileMat = new BABYLON.StandardMaterial("tileMat", this.scene);
            tileMat.diffuseColor = new BABYLON.Color3(0.1, 0.2, 0.1);
            tile.material = tileMat;
        }
    }

    getScene() {
        return this.scene;
    }

    getCamera() {
        return this.camera;
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SceneManager;
}
