/**
 * src/host/telemetry.js — the game's only outbound reporting channel
 *
 * ── Trust boundary, written down on purpose ─────────────────────────────────
 * Everything reported through here is CLIENT-REPORTED AND THEREFORE
 * UNVERIFIABLE. A score, a run depth, a completion time — all of it comes out
 * of a JavaScript context the player fully controls. Any of it can be
 * fabricated with the devtools console open.
 *
 * That is fine, as long as nobody later mistakes it for fact. The reason
 * score reporting goes through this narrow function rather than the game
 * calling fetch() itself is precisely so the day a leaderboard becomes
 * server-authoritative, only this file changes:
 *
 *   - simulation moves server-side, and the client reports inputs, or
 *   - the server recomputes the run from a seed plus an input log, or
 *   - scores stay advisory and are labelled as such in the UI.
 *
 * Until then: do not build anything on these numbers that a cheater could
 * ruin for other people.
 *
 * The default sink is dev-console-only. Nothing leaves the browser.
 */

/**
 * @param {{ sink?: (record: object) => void|Promise<void>, gameId: string, subject: string, debug?: boolean }} opts
 */
export const createTelemetry = ({ sink, gameId, subject, debug = false }) => {
  const send = sink ?? ((record) => {
    if (debug) console.debug('[telemetry]', record.event, record.payload)
  })

  return {
    /**
     * Report a gameplay event. Never throws and never rejects: telemetry
     * failing must not be able to break a run.
     *
     * @param {string} event dot-separated name, e.g. 'run.ended'
     * @param {object} [payload] JSON-serializable detail
     * @returns {Promise<void>}
     */
    async report(event, payload = {}) {
      try {
        await send({
          event: String(event),
          payload,
          gameId,
          // The subject travels with the record so a future backend can bucket
          // events. Note the server must NEVER accept this as proof of
          // identity — see docs/identity.md, "server-side identity".
          subject,
          at: Date.now(),
        })
      } catch (err) {
        console.warn('[telemetry] report failed (ignored):', err)
      }
    },
  }
}
