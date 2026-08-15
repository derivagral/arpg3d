/**
 * src/storage/claim.js — bringing guest saves along at sign-in
 *
 * Signing in switches save namespaces (see src/storage/saveStore.js). Without
 * a bridge, a player who played for an hour as a guest and then signed in
 * would be looking at an empty save list, which reads as data loss even
 * though nothing was lost.
 *
 * The bridge is a COPY, offered once, and only with explicit consent:
 *
 *   - Copy, not move. The guest namespace is left untouched, so signing out
 *     returns the player to exactly what they had. Nothing is ever destroyed
 *     by claiming.
 *   - Fresh slot ids on the copy, so a claim can never overwrite a save that
 *     already exists in the target namespace. Claiming twice would duplicate,
 *     which is why we record that the offer was answered.
 *   - Offered once per (guest → account) pair. Declining is remembered, so a
 *     player who wants a clean account is not nagged on every sign-in.
 *
 * The record is keyed on BOTH subjects: signing into a second account from
 * the same browser gets its own offer, which is the behaviour you want when
 * two people share a machine.
 */

import { IDENTITY_NS, subjectKey } from '../identity/identity.js'
import { createSaveStore } from './saveStore.js'

export const CLAIM_KEY = `${IDENTITY_NS}:claims`

const pairKey = (from, to) => `${subjectKey(from)}>${subjectKey(to)}`

const readClaims = async (backend) => {
  try {
    const raw = await backend?.read(CLAIM_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

const writeClaims = async (backend, claims) => {
  try {
    await backend?.write(CLAIM_KEY, JSON.stringify(claims))
  } catch (_) { /* the offer will simply be made again next time */ }
}

/**
 * Has this guest→account pair already been answered (claimed or declined)?
 * @returns {Promise<boolean>}
 */
export const claimAnswered = async (backend, from, to) =>
  Boolean((await readClaims(backend))[pairKey(from, to)])

/** Record an answer so the offer is not repeated. */
export const recordClaimAnswer = async (backend, from, to, answer) => {
  const claims = await readClaims(backend)
  claims[pairKey(from, to)] = { answer, at: Date.now() }
  await writeClaims(backend, claims)
}

/**
 * Should the shell offer to bring guest saves across?
 *
 * True only when there is something to bring, somewhere to bring it, and the
 * player has not already answered.
 *
 * @param {{ backend: object, from: string|null, to: object }} args
 * @returns {Promise<{ offer: boolean, count: number }>}
 */
export const claimOffer = async ({ backend, from, to }) => {
  const none = { offer: false, count: 0 }
  if (!from || !to?.subject) return none
  if (from === to.subject) return none              // signed in as the guest
  if (to.kind === 'anon') return none               // only upgrades get an offer
  if (await claimAnswered(backend, from, to.subject)) return none

  const count = (await createSaveStore({ backend, subject: from }).list()).length
  return count > 0 ? { offer: true, count } : none
}

/**
 * Copy every save from one subject's namespace into another's.
 *
 * Incompatible saves are skipped rather than failing the whole claim — a
 * schema-version mismatch on one slot must not cost the player the other
 * nine. They stay readable in the guest namespace either way.
 *
 * @param {{ backend: object, from: string, to: string }} args
 * @returns {Promise<{ claimed: number, skipped: Array<{ name: string, reason: string }> }>}
 */
export const claimSaves = async ({ backend, from, to }) => {
  const source = createSaveStore({ backend, subject: from })
  const target = createSaveStore({ backend, subject: to })

  let claimed = 0
  const skipped = []

  for (const slot of await source.list()) {
    const file = await source.get(slot.id)
    if (!file) continue
    try {
      // importSaveFile validates, migrates, and always assigns a fresh id.
      await target.importSaveFile(file)
      claimed++
    } catch (err) {
      skipped.push({ name: slot.name, reason: err.message })
    }
  }

  await recordClaimAnswer(backend, from, to, 'claimed')
  return { claimed, skipped }
}

/** Remember that the player said no, without copying anything. */
export const declineClaim = async ({ backend, from, to }) => {
  await recordClaimAnswer(backend, from, to, 'declined')
}
