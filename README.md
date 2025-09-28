# ARPG3D - Vampire Survivors Clone in Babylon.js

A 3D action RPG with Vampire Survivors-style gameplay built with Babylon.js.

## Features
- ✅ Top-down camera with 3D graphics
- ✅ Auto-attacking to nearest enemy
- ✅ XP and level progression system
- ✅ Enemy wave spawning with increasing difficulty
- ✅ Pickup system with magnetic collection
- ✅ Health and XP drops

## Getting Started

### Local Development
1. Clone this repository
2. Serve the files with any local web server:
   - Python 3: `python -m http.server 8000`
   - Node.js: `npx http-server`
   - VS Code: Use Live Server extension
3. Open http://localhost:8000 in your browser

### Controls
- **WASD** or **Arrow Keys**: Move player
- Auto-attacks nearest enemy within range

## Project Structure
```
├── index.html          # Main HTML file
├── css/
│   └── main.css       # All styles
├── js/
│   ├── main.js        # Entry point
│   ├── game.js        # Game class and logic
│   └── config.js      # Game configuration
└── assets/            # (Future) Models, textures, sounds
```

## Adding Quaternius Assets

1. Download assets from [Quaternius](https://quaternius.com/)
2. Place models in `assets/models/`
3. Replace geometric shapes with loaded models:

```javascript
// Instead of CreateBox/CreateSphere:
BABYLON.SceneLoader.LoadAssetContainer(
    "assets/models/", 
    "character.glb", 
    scene, 
    (container) => {
        const meshes = container.instantiateModelsToScene();
        // Position and scale your model
    }
);
```

## Next Steps

### Phase 1 (Current) ✅
- Basic separation of concerns
- Core gameplay loop

### Phase 2 (Next)
- [ ] Multiple weapon types
- [ ] Enemy variety
- [ ] Upgrade selection on level up
- [ ] Boss enemies

### Phase 3 (Future)
- [ ] Save/load system
- [ ] Multiple characters
- [ ] Map variations
- [ ] Sound effects and music
- [ ] Particle effects
- [ ] Performance optimization with instancing

## Configuration

Edit `js/config.js` to tweak:
- Player stats and progression
- Enemy spawn rates and difficulty
- Weapon damage and speed
- Pickup values and effects
- Camera settings

## Performance Tips

For better performance with many enemies:
- Use Babylon.js instancing for enemies/projectiles
- Implement object pooling
- Use LOD (Level of Detail) for distant objects
- Limit particle effects on mobile

## Browser Support
- Chrome 90+ (recommended)
- Firefox 88+
- Safari 14+
- Edge 90+

## License
Your license here
