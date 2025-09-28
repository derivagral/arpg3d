# ARPG3D - Enhanced Vampire Survivors Clone

A 3D action RPG with wave-based gameplay, upgrade system, and progressive difficulty.

## 🎮 New Features

### Core Gameplay
- ✅ **Wave System**: 8 progressively harder waves with different enemy compositions
- ✅ **Enemy Variety**: 4 enemy types (Basic, Fast, Tank, Swarm)
- ✅ **Attack Cooldown Bar**: Visual feedback for weapon readiness
- ✅ **Extended Attack Range**: Increased from 3 to 8 units with visual indicator
- ✅ **Pause System**: Press ESC or P to pause the game
- ✅ **Upgrade System**: Choose from 3 random upgrades on level up

### Upgrade Options
- **Damage Boost** (+25% damage)
- **Rapid Fire** (-20% cooldown)
- **Extended Range** (+30% range)
- **Life Steal** (heal on kills)
- **Speed Boost** (+15% movement)
- **Max Health** (+30 HP)
- **Magnet Power** (+50% pickup range)
- **Critical Chance** (+15% crit chance)
- **Piercing Shots** (hit multiple enemies)
- **Regeneration** (+1 HP/sec)

### Enemy Types
| Type | Color | Characteristics |
|------|-------|----------------|
| Basic | Red | Standard stats, balanced |
| Fast | Yellow | Quick but fragile |
| Tank | Purple | Slow but high health |
| Swarm | Green | Tiny, numerous, weak |

### Wave Progression
1. **Wave 1**: Basic enemies only (30s)
2. **Wave 2**: Basic + Fast enemies (40s)
3. **Wave 3**: More Fast enemies (45s)
4. **Wave 4**: Tank units introduced (50s)
5. **Wave 5**: Swarm arrives! (60s)
6. **Wave 6**: Chaos mode (60s)
7. **Wave 7**: Elite forces (70s)
8. **Wave 8+**: Maximum threat - all types (80s)

## 📁 Project Structure

```
project/
├── index.html           # Main HTML with UI structure
├── css/
│   └── main.css        # All styles including animations
├── js/
│   ├── config.js       # Game configuration and balance
│   ├── game.js         # Core game logic and mechanics
│   ├── ui.js           # UI management and updates
│   └── main.js         # Entry point and debug tools
└── README.md           # This file
```

## 🎯 Controls

- **WASD** or **Arrow Keys**: Move player
- **ESC** or **P**: Pause game
- Auto-attacks nearest enemy within range

## 🚀 Getting Started

### Option 1: Local Development
```bash
# Python 3
python -m http.server 8000

# Node.js
npx http-server

# Or use VS Code Live Server extension
```

### Option 2: Direct File
Simply open `index.html` in a modern browser (Chrome/Firefox/Edge recommended)

## 🛠 Debug Mode (Localhost Only)

When running locally, debug commands are available in the console:

```javascript
// Give XP
debugCommands.giveXP(100)

// Set health
debugCommands.setHealth(50)

// Skip to wave
debugCommands.skipToWave(5)

// Clear all enemies
debugCommands.clearEnemies()

// Activate god mode
debugCommands.godMode()

// Spawn enemies
debugCommands.spawnEnemy('tank', 3)
```

## ⚙️ Configuration

Edit `js/config.js` to customize:
- Player stats and progression
- Enemy types and behaviors
- Wave composition and timing
- Upgrade effects
- Visual settings

### Key Configuration Areas

#### Player Balance
```javascript
initialHealth: 100,
initialDamage: 10,
initialAttackSpeed: 1000, // ms
initialAttackRange: 8
```

#### Wave Settings
```javascript
waves: {
    1: { 
        duration: 30000, 
        enemies: ['basic'], 
        spawnRate: 2000, 
        message: "The horde approaches!" 
    },
    // ... more waves
}
```

## 🎨 Customization Tips

### Adding New Enemy Types
1. Add enemy config in `CONFIG.enemies.types`
2. Include in wave configurations
3. Set unique colors and stats

### Creating New Upgrades
1. Add upgrade object to `CONFIG.upgrades`
2. Define name, description, stat display
3. Implement `apply` function

### Modifying Waves
1. Edit `CONFIG.waves` object
2. Set duration, enemy types, spawn rate
3. Add custom wave message

## 📊 Performance Optimization

- Uses Babylon.js engine optimizations
- Object pooling for projectiles (future enhancement)
- Automatic quality reduction on mobile
- FPS counter for monitoring

## 🔄 Next Steps

### Immediate Improvements
- [ ] Sound effects and music
- [ ] Particle effects for impacts
- [ ] More weapon types
- [ ] Boss enemies at wave ends

### Future Features
- [ ] Character selection
- [ ] Persistent upgrades
- [ ] Leaderboard system
- [ ] Multiple maps/environments
- [ ] Co-op multiplayer

## 🐛 Known Issues

- Range indicator may not update immediately after upgrade
- Performance may drop with 50+ enemies on screen
- Mobile touch controls not yet implemented

## 📝 Claude Code Integration

This project structure is perfect for Claude Code if you want to:
- Add version control
- Implement more complex features
- Collaborate with others
- Deploy to a web server

To use with Claude Code:
1. Create a new project
2. Copy these files into the project
3. Use Claude Code's built-in server
4. Iterate with AI assistance

## 🎮 Game Tips

- **Early Game**: Focus on damage and attack speed upgrades
- **Mid Game**: Balance survivability with offense
- **Late Game**: Life steal and regeneration become crucial
- **Wave 5+**: Prioritize crowd control (piercing shots)
- **Boss Preparation**: Save health pickups when possible

## 📜 License

MIT License - Feel free to modify and distribute

## 🙏 Credits

- Babylon.js for 3D engine
- Inspired by Vampire Survivors
- Enhanced by Claude AI

---

**Happy Surviving!** 🎯🗡️🛡️