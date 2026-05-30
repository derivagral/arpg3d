/**
 * MarkerManager - Owns the in-map objective markers and the rules that drive them.
 *
 * Markers are data-driven (see CONFIG.markers). Each definition declares a
 * trigger type, an optional buff, and/or an objective. To experiment with new
 * marker types or placement, edit CONFIG.markers — no code changes needed.
 *
 * Trigger types:
 *   onEnter      one-shot: applies a (usually timed) buff the first time the
 *                player enters, then the marker is spent. Shrine concept.
 *   whileInside  buff is active only while the player stands in the radius and
 *                is removed on exit. Pure linger / area-tradeoff concept.
 *   objective    starts a timed mini-objective (e.g. "clear N enemies in zone"),
 *                optionally cranking spawn modifiers, with pass/fail/reward.
 *
 * Markers refresh per entry: spawn() rebuilds them every time the combat zone
 * is entered, and clear() tears them down (reverting any lingering effects).
 */
class MarkerManager {
    constructor(game) {
        this.game = game;
        this.markers = [];
        this.activeObjective = null; // only one objective runs at a time
    }

    // Quadrant -> [x, z] offset, scaled to the area size.
    quadrantOffset(quadrant, groundSize) {
        const q = groundSize / 4;
        const map = {
            NE: [q, q], NW: [-q, q], SE: [q, -q], SW: [-q, -q],
            C: [0, 0]
        };
        return map[quadrant] || [0, 0];
    }

    spawn(areaName) {
        this.clear();

        const defs = (CONFIG.markers && CONFIG.markers[areaName]) || [];
        if (!defs.length) return;

        const area = this.game.areaManager.getCurrentArea();
        const groundSize = (area && area.groundSize) || 60;

        defs.forEach(def => {
            const off = this.quadrantOffset(def.quadrant, groundSize);
            const pos = new BABYLON.Vector3(off[0], 0, off[1]);
            const marker = new Marker(this.game.scene, pos, def);
            this.markers.push(marker);
        });
    }

    clear() {
        // Revert any lingering effects before disposing.
        this.markers.forEach(marker => {
            const def = marker.def;
            if (def && def.trigger === 'whileInside' && marker.inside && def.buff) {
                this.game.player.removeBuff(def.buff.id);
            }
            marker.dispose();
        });
        this.revertObjectiveSpawnMods();

        this.markers = [];
        this.activeObjective = null;
    }

    update(deltaTime) {
        if (!this.markers.length) return;

        const playerPos = this.game.player.mesh.position;

        this.markers.forEach(marker => {
            marker.update(deltaTime);

            const inside = marker.isPlayerInside(playerPos);
            if (inside && !marker.inside) {
                marker.inside = true;
                this.handleEnter(marker);
            } else if (!inside && marker.inside) {
                marker.inside = false;
                this.handleExit(marker);
            }

            // Objective markers charge up before committing — cancel if the
            // player steps back out during the linger window.
            if (marker.arming) {
                this.updateArming(marker, deltaTime, inside);
            }
        });

        if (this.activeObjective) {
            this.updateObjective(deltaTime);
        }
    }

    handleEnter(marker) {
        const def = marker.def;

        if (def.trigger === 'whileInside') {
            if (def.buff) this.game.player.addBuff({ ...def.buff });
            marker.setState('active');
            this.notify(`${def.name}: ${def.desc || (def.buff && def.buff.name) || 'active'}`);

        } else if (def.trigger === 'onEnter') {
            if (marker.fired) return;
            marker.fired = true;
            if (def.buff) this.game.player.addBuff({ ...def.buff });
            marker.setState('spent');
            this.notify(`${def.name}: ${def.desc || 'activated!'}`);

        } else if (def.trigger === 'objective') {
            if (marker.fired || marker.arming || this.activeObjective) return; // one at a time
            const delay = def.objective.armDelay != null ? def.objective.armDelay : 0;
            if (delay > 0) {
                // Begin a linger/charge-up; the player can leave to back out.
                marker.arming = { elapsed: 0, delay };
                marker.setState('active');
                this.notify(`${def.name}: ${def.desc || 'objective'} — stay to begin`);
            } else {
                this.startObjective(marker);
            }
        }
    }

    updateArming(marker, deltaTime, inside) {
        const arm = marker.arming;

        // Player left the radius before committing — cancel and reset.
        if (!inside) {
            marker.arming = null;
            marker.clearFill();
            marker.setState('idle');
            return;
        }

        arm.elapsed += deltaTime;
        marker.setFill(arm.elapsed / arm.delay, marker.glowColor);

        if (arm.elapsed >= arm.delay) {
            marker.arming = null;
            marker.clearFill();
            this.startObjective(marker);
        }
    }

    handleExit(marker) {
        const def = marker.def;
        if (def.trigger === 'whileInside') {
            if (def.buff) this.game.player.removeBuff(def.buff.id);
            marker.setState('idle');
        }
    }

    startObjective(marker) {
        const def = marker.def;
        const obj = def.objective;
        marker.fired = true;

        this.activeObjective = {
            marker,
            type: obj.type,
            goal: obj.goal,
            count: 0,
            remaining: obj.duration,
            durationTotal: obj.duration,
            reward: obj.reward || {},
            spawnMods: obj.spawnMods || {}
        };

        // Crank up spawn modifiers for the duration (difficulty-tradeoff).
        for (const k in this.activeObjective.spawnMods) {
            this.game.spawnManager.applyModifier(k, this.activeObjective.spawnMods[k]);
        }

        marker.setState('active');
        this.notify(`${def.name}: clear ${obj.goal} in the zone!`);
    }

    updateObjective(deltaTime) {
        const ao = this.activeObjective;
        ao.remaining -= deltaTime;

        // Drain the fill disc as the clock runs down (red → empty).
        ao.marker.setFill(ao.remaining / ao.durationTotal, new BABYLON.Color3(1, 0.5, 0.15));

        if (ao.count >= ao.goal) {
            this.finishObjective(true);
        } else if (ao.remaining <= 0) {
            this.finishObjective(false);
        }
    }

    finishObjective(success) {
        const ao = this.activeObjective;
        this.revertObjectiveSpawnMods();
        ao.marker.clearFill();

        if (success) {
            ao.marker.setState('success');
            const r = ao.reward;
            if (r.gold) this.game.player.addGold(r.gold);
            if (r.buff) this.game.player.addBuff({ ...r.buff });
            this.notify(`${ao.marker.def.name} complete!${r.gold ? ' +' + r.gold + ' gold' : ''}`);
        } else {
            ao.marker.setState('fail');
            this.notify(`${ao.marker.def.name} failed!`);
        }

        this.activeObjective = null;
    }

    revertObjectiveSpawnMods() {
        if (!this.activeObjective) return;
        const mods = this.activeObjective.spawnMods || {};
        for (const k in mods) {
            // applyModifier multiplies; dividing restores the prior value.
            this.game.spawnManager.applyModifier(k, 1 / mods[k]);
        }
    }

    // Called from Game.handleEnemyDeath for every kill (with its world position).
    onEnemyKilled(enemy, position) {
        const ao = this.activeObjective;
        if (!ao) return;

        if (ao.type === 'kills' && ao.marker.isPlayerInside(position)) {
            ao.count++;
        }
    }

    notify(message) {
        if (this.game.ui && this.game.ui.showWaveIndicator) {
            this.game.ui.showWaveIndicator(message);
        }
    }

    // Lines for the HUD: active objective progress + countdown.
    getStatus() {
        const lines = [];

        // Arming charge-up (before an objective commits)
        this.markers.forEach(marker => {
            if (marker.arming) {
                const pct = Math.round((marker.arming.elapsed / marker.arming.delay) * 100);
                lines.push(`${marker.def.name}: charging ${pct}%`);
            }
        });

        if (this.activeObjective) {
            const ao = this.activeObjective;
            const secs = Math.max(0, Math.ceil(ao.remaining / 1000));
            lines.push(`${ao.marker.def.name}: ${ao.count}/${ao.goal} (${secs}s)`);
        }
        return lines;
    }
}

// Export for Node-based use/tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MarkerManager;
}
