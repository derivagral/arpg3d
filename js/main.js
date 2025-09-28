// Main entry point
window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById("renderCanvas");
    const engine = new BABYLON.Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true
    });
    
    // Create and start the game
    const game = new Game(engine, canvas);
    game.start();
    
    // Debug helpers (remove in production)
    window.game = game; // Access game state from console
    
    // Optional: Show FPS
    const showFPS = false;
    if (showFPS) {
        const fpsElement = document.createElement('div');
        fpsElement.style.position = 'absolute';
        fpsElement.style.top = '10px';
        fpsElement.style.right = '10px';
        fpsElement.style.color = 'white';
        fpsElement.style.fontFamily = 'monospace';
        fpsElement.style.fontSize = '14px';
        fpsElement.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
        document.body.appendChild(fpsElement);
        
        setInterval(() => {
            fpsElement.textContent = `FPS: ${engine.getFps().toFixed()}`;
        }, 100);
    }
});
