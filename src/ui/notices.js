/**
 * src/ui/notices.js — HUD nudges (badges + flashes)
 *
 * A small, channel-based notice rail. A *channel* is one persistent thing the
 * player might want to act on: it owns a badge that can carry a count, and can
 * flash when its value changes.
 *
 * Only the `inventory` channel is registered today, on purpose. Buff timers and
 * combat alerts are a different problem — they are transient, they compete with
 * the action, and they need positioning near the player rather than a corner
 * rail. This module is shaped so they can be added as channels later, but
 * adding them now would mean designing for content that does not exist.
 *
 * Two levels of loudness, deliberately separated:
 *   badge  — persistent state ("3 new"). Always truthful, never animated.
 *   flash  — a one-shot pulse when something *changed*. Attention, not state.
 *
 * The distinction matters because a badge that animates forever becomes
 * wallpaper, and a flash that persists becomes clutter.
 */

const css = `
#noticeRail{position:fixed;right:14px;bottom:14px;z-index:130;
  display:flex;flex-direction:column;gap:8px;align-items:flex-end;
  font-family:monospace;pointer-events:none}
#noticeRail .nz{display:flex;align-items:center;gap:9px;
  padding:8px 13px;border-radius:8px;
  background:rgba(10,12,18,0.86);border:1px solid rgba(255,255,255,0.14);
  color:#e8e8e8;font-size:13px;pointer-events:auto;cursor:pointer;
  opacity:0;transform:translateY(6px);
  transition:opacity 0.18s,transform 0.18s,border-color 0.18s}
#noticeRail .nz.show{opacity:1;transform:translateY(0)}
#noticeRail .nz:hover{border-color:#7fb8ff}
#noticeRail .nz-icon{font-size:15px;line-height:1}
#noticeRail .nz-count{min-width:20px;text-align:center;padding:1px 6px;
  border-radius:10px;background:#7fb8ff;color:#0b1018;font-weight:bold;
  font-size:12px}
#noticeRail .nz-key{color:#8a93a0;font-size:11px}
#noticeRail .nz.flash{animation:nzflash 0.5s ease-out}
@keyframes nzflash{
  0%{transform:scale(1)}
  30%{transform:scale(1.09);border-color:#7fb8ff;
      box-shadow:0 0 14px rgba(127,184,255,0.55)}
  100%{transform:scale(1)}}
`

/** Channel definitions. Add here; nothing else needs to change. */
const CHANNELS = {
  inventory: { icon: '🎒', key: 'E', label: 'new' },
}

export const createNotices = () => {
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  const rail = document.createElement('div')
  rail.id = 'noticeRail'
  document.body.appendChild(rail)

  const els = {}
  const counts = {}

  const ensure = (id) => {
    if (els[id]) return els[id]
    const def = CHANNELS[id]
    if (!def) return null
    const el = document.createElement('div')
    el.className = 'nz'
    el.innerHTML =
      `<span class="nz-icon">${def.icon}</span>` +
      `<span class="nz-count"></span>` +
      `<span class="nz-key">${def.label} · ${def.key}</span>`
    rail.appendChild(el)
    els[id] = el
    return el
  }

  return {
    /**
     * Set a channel's count. Shows the badge when > 0, hides it at 0, and
     * flashes only when the number actually goes up — so re-rendering the
     * same state never nags.
     */
    set(id, count, onClick) {
      const el = ensure(id)
      if (!el) return
      const prev = counts[id] ?? 0
      counts[id] = count

      if (count <= 0) {
        el.classList.remove('show')
        return
      }
      el.querySelector('.nz-count').textContent = count > 99 ? '99+' : String(count)
      el.classList.add('show')
      if (onClick) el.onclick = onClick
      if (count > prev) this.flash(id)
    },

    /** One-shot pulse. Safe to call repeatedly; the animation restarts. */
    flash(id) {
      const el = els[id]
      if (!el) return
      el.classList.remove('flash')
      void el.offsetWidth      // force reflow so the animation replays
      el.classList.add('flash')
    },

    clear(id) { this.set(id, 0) },
  }
}
