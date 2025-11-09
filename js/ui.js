// UI Manager Class
class UIManager {
    constructor(game) {
        this.game = game;
        this.initializeElements();
    }

    initializeElements() {
        // Cache DOM elements for performance
        this.elements = {
            healthFill: document.getElementById('healthFill'),
            cooldownFill: document.getElementById('cooldownFill'),
            wave: document.getElementById('wave'),
            enemyCount: document.getElementById('enemyCount'),
            timer: document.getElementById('timer'),
            level: document.getElementById('level'),
            xp: document.getElementById('xp'),
            waveIndicator: document.getElementById('waveIndicator'),
            waveNumber: document.getElementById('waveNumber'),
            waveMessage: document.getElementById('waveMessage'),
            pauseOverlay: document.getElementById('pauseOverlay'),
            upgradeMenu: document.getElementById('upgradeMenu'),
            upgradeOptions: document.getElementById('upgradeOptions'),
            inventoryScreen: document.getElementById('inventoryScreen'),
            inventoryGrid: document.getElementById('inventoryGrid'),
            invLevel: document.getElementById('inv-level'),
            invHealth: document.getElementById('inv-health'),
            invDamage: document.getElementById('inv-damage'),
            invAttackSpeed: document.getElementById('inv-attackSpeed'),
            invSpeed: document.getElementById('inv-speed'),
            invRange: document.getElementById('inv-range'),
            invCrit: document.getElementById('inv-crit'),
            invLifesteal: document.getElementById('inv-lifesteal'),
            invPiercing: document.getElementById('inv-piercing'),
            invRegen: document.getElementById('inv-regen')
        };

        // Initialize inventory slots
        this.initializeInventorySlots();
    }

    initializeInventorySlots() {
        const slotsCount = 24; // 24 inventory slots for now

        for (let i = 0; i < slotsCount; i++) {
            const slot = document.createElement('div');
            slot.className = 'inventory-slot empty';
            slot.innerHTML = '<div class="inventory-slot-icon">□</div>';
            slot.dataset.slotIndex = i;
            this.elements.inventoryGrid.appendChild(slot);
        }
    }

    updateHealthBar() {
        const percentage = Math.max(0,
            this.game.player.stats.health / this.game.player.stats.maxHealth * 100
        );
        this.elements.healthFill.style.width = percentage + '%';

        // Change color based on health percentage
        if (percentage < 25) {
            this.elements.healthFill.style.background = 'linear-gradient(to right, #cc0000, #ff3333)';
        } else if (percentage < 50) {
            this.elements.healthFill.style.background = 'linear-gradient(to right, #ff6600, #ff9933)';
        } else {
            this.elements.healthFill.style.background = 'linear-gradient(to right, #ff3333, #ff6666)';
        }
    }

    updateCooldownBar(progress) {
        this.elements.cooldownFill.style.width = (progress * 100) + '%';
    }

    updateStats() {
        const state = this.game.state;

        this.elements.wave.textContent = `Wave: ${this.game.spawnManager.currentWave}`;
        this.elements.enemyCount.textContent = `Enemies: ${state.enemies.length}`;

        const elapsed = Date.now() - state.startTime;
        this.elements.timer.textContent = `Time: ${this.game.formatTime(elapsed)}`;

        this.elements.level.textContent = `Level: ${this.game.player.level}`;
        this.elements.xp.textContent =
            `XP: ${Math.floor(this.game.player.stats.xp)} / ${this.game.player.stats.xpToNext}`;
    }

    showWaveIndicator(waveNum) {
        const waveConfig = CONFIG.waves[waveNum] || CONFIG.waves[8];
        
        this.elements.waveNumber.textContent = waveNum;
        this.elements.waveMessage.textContent = waveConfig.message;
        
        this.elements.waveIndicator.classList.add('show');
        
        setTimeout(() => {
            this.elements.waveIndicator.classList.remove('show');
        }, CONFIG.ui.waveIndicatorDuration);
    }

    showPauseOverlay() {
        this.elements.pauseOverlay.classList.add('show');
    }

    hidePauseOverlay() {
        this.elements.pauseOverlay.classList.remove('show');
    }

    showUpgradeMenu() {
        const menu = this.elements.upgradeMenu;
        const optionsDiv = this.elements.upgradeOptions;
        optionsDiv.innerHTML = '';
        
        // Get 3 random upgrades
        const availableUpgrades = [...CONFIG.upgrades];
        const selectedUpgrades = [];
        
        for (let i = 0; i < Math.min(3, availableUpgrades.length); i++) {
            const index = Math.floor(Math.random() * availableUpgrades.length);
            selectedUpgrades.push(availableUpgrades.splice(index, 1)[0]);
        }
        
        selectedUpgrades.forEach(upgrade => {
            const div = document.createElement('div');
            div.className = 'upgrade-option';
            div.innerHTML = `
                <h3>${upgrade.name}</h3>
                <p>${upgrade.description}</p>
                <div class="stats">${upgrade.stat}</div>
            `;
            
            div.onclick = () => this.handleUpgradeSelection(upgrade);
            optionsDiv.appendChild(div);
        });
        
        menu.classList.add('show');
    }

    hideUpgradeMenu() {
        this.elements.upgradeMenu.classList.remove('show');
    }

    handleUpgradeSelection(upgrade) {
        // Apply the upgrade
        upgrade.apply(this.game);

        // Decrease pending upgrades
        this.game.state.upgradesPending--;

        // Hide menu
        this.hideUpgradeMenu();

        // Update UI if needed
        this.updateHealthBar();

        // Check if we should unpause
        if (this.game.state.upgradesPending <= 0) {
            this.game.togglePause();
        } else {
            // Show next upgrade choices
            this.showUpgradeMenu();
        }
    }

    animateLevelUp() {
        this.elements.level.classList.add('level-up-animation');
        setTimeout(() => {
            this.elements.level.classList.remove('level-up-animation');
        }, 500);
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 20px;
            border-radius: 10px;
            font-size: 24px;
            z-index: 200;
            animation: fadeInOut 2s ease;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 2000);
    }

    createDamageNumber(position, damage, isCrit = false) {
        // This would require integration with Babylon.js for 3D text
        // For now, we'll skip this feature
        // Could be implemented with dynamic texture or GUI
    }

    updateDebugInfo(fps) {
        if (!this.debugElement) return;
        this.debugElement.textContent = `FPS: ${fps}`;
    }

    showInventory() {
        this.elements.inventoryScreen.classList.add('show');
        this.updateInventoryStats();
    }

    hideInventory() {
        this.elements.inventoryScreen.classList.remove('show');
    }

    updateInventoryStats() {
        const player = this.game.player;
        const stats = player.stats;

        // Update all stat displays
        this.elements.invLevel.textContent = player.level;
        this.elements.invHealth.textContent = `${Math.floor(stats.health)} / ${stats.maxHealth}`;
        this.elements.invDamage.textContent = stats.damage;
        this.elements.invAttackSpeed.textContent = `${stats.attackSpeed}ms`;
        this.elements.invSpeed.textContent = stats.speed.toFixed(2);
        this.elements.invRange.textContent = stats.attackRange;
        this.elements.invCrit.textContent = `${(stats.critChance * 100).toFixed(0)}%`;
        this.elements.invLifesteal.textContent = stats.lifeSteal;
        this.elements.invPiercing.textContent = stats.piercing;
        this.elements.invRegen.textContent = `${stats.regen}/s`;
    }
}