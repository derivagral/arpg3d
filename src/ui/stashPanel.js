/**
 * src/ui/stashPanel.js — the Armory: Haul → Vault → Loadout
 *
 * Terminology is deliberate, and deliberately not survival-looter:
 *   Haul     what this run has turned up so far (run-scoped, lost on nothing,
 *            banked automatically when the run ends)
 *   Vault    the character's permanent collection
 *   Loadout  what you are wearing. FIXED for the duration of a run.
 *
 * Because the loadout is static per run, equipping is a between-runs planning
 * action and the Loadout column is READ-ONLY inside the combat zone — there is
 * no action to offer there, so the screen doesn't pretend otherwise.
 *
 * Reads the canonical sources directly: the haul from SimState, the vault and
 * loadout from the character profile.
 *
 * All mutations go through the pure helpers in sim/inventory.js and are handed
 * back to the host via callbacks, so this file owns no game state.
 *
 * Deliberately plain: three columns, click to move, hover for a tooltip. The
 * point right now is that transferring works and reads honestly, not that it
 * looks finished.
 */

import { SLOTS, itemName, itemScore, rarityInfo, affixMeta } from '../../sim/items.js'
import {
  countItems, transfer, equipFrom, unequipTo, autoEquip, sortContainer,
  loadoutScore, bestSlotFor,
} from '../../sim/inventory.js'

const SLOT_LABELS = {
  head: 'Head', chest: 'Chest', hands: 'Hands', legs: 'Legs', feet: 'Feet',
  weapon: 'Weapon', offhand: 'Offhand', ring1: 'Ring I', ring2: 'Ring II',
  amulet: 'Amulet',
}

const css = `
#stashPanel{position:fixed;inset:0;z-index:200;display:none;
  background:rgba(6,8,12,0.88);backdrop-filter:blur(3px);
  font-family:monospace;color:#e8e8e8}
#stashPanel.show{display:flex;flex-direction:column}
#stashPanel .sp-head{display:flex;align-items:baseline;gap:16px;
  padding:14px 22px;border-bottom:1px solid rgba(255,255,255,0.12)}
#stashPanel .sp-title{font-size:19px;font-weight:bold;color:#7fb8ff}
#stashPanel .sp-sub{font-size:12px;color:#9aa4b2}
#stashPanel .sp-close{margin-left:auto;font-size:12px;color:#9aa4b2}
#stashPanel .sp-body{flex:1;display:grid;grid-template-columns:1fr 1fr 260px;
  gap:14px;padding:14px 22px;overflow:hidden}
#stashPanel .sp-col{display:flex;flex-direction:column;min-height:0;
  border:1px solid rgba(255,255,255,0.10);border-radius:8px;
  background:rgba(255,255,255,0.02)}
#stashPanel .sp-colhead{display:flex;align-items:center;gap:8px;padding:9px 12px;
  border-bottom:1px solid rgba(255,255,255,0.10);font-size:13px}
#stashPanel .sp-count{color:#9aa4b2;font-size:11px;margin-left:auto}
#stashPanel .sp-grid{flex:1;overflow-y:auto;padding:10px;
  display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));
  gap:6px;align-content:start}
#stashPanel .sp-cell{aspect-ratio:1;border:1px solid rgba(255,255,255,0.10);
  border-radius:5px;background:rgba(255,255,255,0.03);display:flex;
  align-items:center;justify-content:center;font-size:17px;cursor:default}
#stashPanel .sp-cell.filled{cursor:pointer}
#stashPanel .sp-cell.filled:hover{border-color:#7fb8ff;background:rgba(127,184,255,0.12)}
#stashPanel .sp-eq{padding:10px;display:flex;flex-direction:column;gap:5px;
  overflow-y:auto}
#stashPanel .sp-eqrow{display:flex;align-items:center;gap:9px;padding:6px 9px;
  border:1px solid rgba(255,255,255,0.09);border-radius:5px;font-size:12px}
#stashPanel .sp-eqrow.filled{cursor:pointer}
#stashPanel .sp-eqrow.filled:hover{border-color:#7fb8ff}
#stashPanel .sp-eqslot{color:#8a93a0;width:58px;flex:none}
#stashPanel .sp-eqitem{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#stashPanel .sp-btn{background:rgba(127,184,255,0.14);border:1px solid rgba(127,184,255,0.4);
  color:#cfe4ff;border-radius:5px;padding:3px 9px;font-family:monospace;
  font-size:11px;cursor:pointer}
#stashPanel .sp-btn:hover{background:rgba(127,184,255,0.28)}
#stashPanel .sp-foot{padding:9px 22px;border-top:1px solid rgba(255,255,255,0.12);
  font-size:11px;color:#8a93a0;display:flex;gap:18px;flex-wrap:wrap}
#stashPanel .sp-warn{color:#ffcc66}
#spTip{position:fixed;z-index:210;display:none;pointer-events:none;max-width:290px;
  background:rgba(8,10,15,0.97);border:1px solid #555;border-radius:6px;
  padding:9px 11px;font-family:monospace;font-size:12px;color:#ddd}
#spTip .t-name{font-weight:bold;margin-bottom:1px}
#spTip .t-meta{color:#8a93a0;font-size:11px;margin-bottom:6px}
#spTip .t-affix{color:#a8d8ff}
#spTip .t-hint{color:#7f8894;margin-top:7px;font-size:11px}
`

/**
 * @param {{
 *   getBag: () => (object|null)[],
 *   canEquip: () => boolean,   — false while a run is in progress
 *   getProfile: () => object,
 *   onChange: (patch: { inventory?, equipment?, profile? }) => void,
 *   onClose?: () => void,
 * }} opts
 */
export const createStashPanel = ({ getBag, canEquip, getProfile, onChange, onClose }) => {
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'stashPanel'
  root.innerHTML = `
    <div class="sp-head">
      <span class="sp-title">Armory</span>
      <span class="sp-sub" id="spSub"></span>
      <span class="sp-close">ESC / I / E to close</span>
    </div>
    <div class="sp-body">
      <div class="sp-col">
        <div class="sp-colhead"><span>Haul</span>
          <span class="sp-count" id="spBagCount"></span>
          <button class="sp-btn" id="spDepositAll">Store all →</button></div>
        <div class="sp-grid" id="spBag"></div>
      </div>
      <div class="sp-col">
        <div class="sp-colhead"><span>Vault</span>
          <span class="sp-count" id="spStashCount"></span>
          <button class="sp-btn" id="spSort">Sort</button></div>
        <div class="sp-grid" id="spStash"></div>
      </div>
      <div class="sp-col">
        <div class="sp-colhead"><span>Loadout</span>
          <span class="sp-count" id="spScore"></span>
          <button class="sp-btn" id="spAuto">Best</button></div>
        <div class="sp-eq" id="spEquip"></div>
      </div>
    </div>
    <div class="sp-foot">
      <span id="spHints"></span>
      <span id="spNote"></span>
    </div>`
  document.body.appendChild(root)

  const tip = document.createElement('div')
  tip.id = 'spTip'
  document.body.appendChild(tip)

  const $ = (id) => root.querySelector('#' + id)
  let note = ''

  // ── tooltip ───────────────────────────────────────────────────────────────
  const showTip = (item, e, hint) => {
    const info = rarityInfo(item.rarity)
    tip.innerHTML =
      `<div class="t-name" style="color:${info.color}">${itemName(item)}</div>` +
      `<div class="t-meta">${item.rarity} ${item.kind} · ilvl ${item.ilvl} · score ${itemScore(item)}</div>` +
      item.affixes.map(a => `<div class="t-affix">${affixMeta(a.id).desc}</div>`).join('') +
      (hint ? `<div class="t-hint">${hint}</div>` : '')
    tip.style.borderColor = info.color
    tip.style.display = 'block'
    moveTip(e)
  }
  const moveTip = (e) => {
    if (tip.style.display !== 'block') return
    const r = tip.getBoundingClientRect()
    let x = e.clientX + 14, y = e.clientY + 14
    if (x + r.width > window.innerWidth) x = e.clientX - r.width - 14
    if (y + r.height > window.innerHeight) y = e.clientY - r.height - 14
    tip.style.left = x + 'px'
    tip.style.top = y + 'px'
  }
  const hideTip = () => { tip.style.display = 'none' }

  // ── rendering ─────────────────────────────────────────────────────────────
  const cell = (item, onClick, hint) => {
    const el = document.createElement('div')
    el.className = 'sp-cell' + (item ? ' filled' : '')
    if (item) {
      const info = rarityInfo(item.rarity)
      el.textContent = '◆'
      el.style.color = info.color
      el.style.borderColor = info.color + '66'
      el.addEventListener('mouseenter', (e) => showTip(item, e, hint))
      el.addEventListener('mousemove', moveTip)
      el.addEventListener('mouseleave', hideTip)
      el.addEventListener('click', () => { hideTip(); onClick() })
    } else {
      el.textContent = '·'
      el.style.color = '#39414d'
    }
    return el
  }

  const render = () => {
    const bag = getBag()
    const profile = getProfile()
    const stash = profile.stash
    const equipment = profile.equipment
    const editable = canEquip ? canEquip() : true

    $('spSub').textContent = editable
      ? 'Gear is fixed once a run starts — set your loadout here.'
      : 'Run in progress: your loadout is locked until you return.'
    $('spHints').textContent = editable
      ? 'Haul → click to store · Vault → click to equip · Loadout → click to remove'
      : 'Haul → click to store · Vault and Loadout are locked mid-run'

    // Bag → stash
    const bagEl = $('spBag')
    bagEl.innerHTML = ''
    bag.forEach((item, i) => {
      bagEl.appendChild(cell(item, () => {
        const res = transfer(bag, stash, i)
        if (!res.moved) { note = 'Vault is full.'; render(); return }
        note = ''
        onChange({ inventory: res.from, profile: { ...profile, stash: res.to } })
        render()
      }, 'Click → store in the vault'))
    })
    $('spBagCount').textContent = `${countItems(bag)} / ${bag.length}`

    // Stash → equip into the best matching slot
    const stashEl = $('spStash')
    stashEl.innerHTML = ''
    stash.forEach((item, i) => {
      stashEl.appendChild(cell(item, () => {
        if (!editable) { note = 'Return to base to change your loadout.'; render(); return }
        const target = bestSlotFor(item, equipment)
        const res = equipFrom(equipment, stash, i, target)
        if (!res.equipped) { note = `Cannot equip: ${res.reason}`; render(); return }
        note = `Equipped ${itemName(res.equipped)} → ${SLOT_LABELS[target]}`
        onChange({ profile: { ...profile, equipment: res.equipment, stash: res.container } })
        render()
      }, editable ? 'Click → equip' : 'Locked until you return to base'))
    })
    $('spStashCount').textContent = `${countItems(stash)} / ${stash.length}`

    // Equipment
    const eqEl = $('spEquip')
    eqEl.innerHTML = ''
    for (const slot of SLOTS) {
      const item = equipment[slot]
      const row = document.createElement('div')
      row.className = 'sp-eqrow' + (item ? ' filled' : '')
      const info = item ? rarityInfo(item.rarity) : null
      row.innerHTML =
        `<span class="sp-eqslot">${SLOT_LABELS[slot]}</span>` +
        `<span class="sp-eqitem" style="color:${info ? info.color : '#4c5563'}">` +
        `${item ? itemName(item) : '—'}</span>`
      if (item) {
        row.addEventListener('mouseenter', (e) =>
          showTip(item, e, editable ? 'Click → return to the vault' : 'Locked until you return to base'))
        row.addEventListener('mousemove', moveTip)
        row.addEventListener('mouseleave', hideTip)
        row.addEventListener('click', () => {
          hideTip()
          if (!editable) { note = 'Return to base to change your loadout.'; render(); return }
          const res = unequipTo(equipment, stash, slot)
          if (!res.removed) { note = 'Vault is full.'; render(); return }
          note = ''
          onChange({ profile: { ...profile, equipment: res.equipment, stash: res.container } })
          render()
        })
      }
      eqEl.appendChild(row)
    }
    $('spScore').textContent = `score ${loadoutScore(equipment)}`
    $('spNote').innerHTML = note ? `<span class="sp-warn">${note}</span>` : ''
  }

  // ── bulk actions ──────────────────────────────────────────────────────────
  $('spDepositAll').addEventListener('click', () => {
    const profile = getProfile()
    let bag = getBag()
    let stash = profile.stash
    let moved = 0
    for (let i = 0; i < bag.length; i++) {
      if (!bag[i]) continue
      const res = transfer(bag, stash, i)
      if (!res.moved) break
      bag = res.from; stash = res.to; moved++
    }
    note = moved ? `Stored ${moved}.` : 'Nothing to store (or the vault is full).'
    onChange({ inventory: bag, profile: { ...profile, stash } })
    render()
  })

  $('spSort').addEventListener('click', () => {
    const profile = getProfile()
    onChange({ profile: { ...profile, stash: sortContainer(profile.stash) } })
    note = ''
    render()
  })

  $('spAuto').addEventListener('click', () => {
    if (canEquip && !canEquip()) { note = 'Return to base to change your loadout.'; render(); return }
    const profile = getProfile()
    const res = autoEquip(profile.equipment, profile.stash)
    note = res.changes.length
      ? `Equipped ${res.changes.length} upgrade(s).`
      : 'Nothing in the vault beats what you have.'
    onChange({ profile: { ...profile, equipment: res.equipment, stash: res.container } })
    render()
  })

  const close = () => {
    if (!root.classList.contains('show')) return
    root.classList.remove('show')
    hideTip()
    if (onClose) onClose()
  }
  root.querySelector('.sp-close').addEventListener('click', close)

  // ESC, I or E closes — whichever key you opened it with also shuts it.
  // Captured so the game's key handler (which would unpause on ESC) never
  // sees it while the panel owns the screen.
  window.addEventListener('keydown', (e) => {
    if (!root.classList.contains('show')) return
    const k = e.key.toLowerCase()
    if (k === 'escape' || k === 'e' || k === 'i') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }, true)

  return {
    open() { note = ''; render(); root.classList.add('show') },
    close,
    isOpen: () => root.classList.contains('show'),
    refresh: () => { if (root.classList.contains('show')) render() },
  }
}
