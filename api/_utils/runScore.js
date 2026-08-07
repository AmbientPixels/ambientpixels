// runScore — pull the headline score out of an agent run result.
//
// WHY THIS EXISTS (2026-08-07): both share endpoints hardcoded
//   result.score ?? result.overall_score
// but only ONE of the 24 agents (roast-my-site) actually uses the key `score`.
// The other nine scoring agents use their own domain key — ats_score,
// quality_score, viability_score, persuasion_score, design_score,
// standout_score, original_score, productivity_score, their_score — so the
// share card rendered with NO SCORE for 9 of 10 scoring agents, silently.
// The score is the single most shareable element of a roast ("I got 41/100"),
// so this quietly broke the viral loop for almost the whole catalog.
//
// Deliberately schema-free: it reads the result object rather than loading the
// agent registry, so a new agent inventing `charisma_score` works on day one
// with no registration step. Shared module rather than duplicated in both
// endpoints, because a "keep these in sync" comment is exactly how this class
// of bug returns.

const EXPLICIT_KEYS = ['score', 'overall_score'];
const SCORE_KEY_RX = /(^|_)score$/;

/**
 * @param {object} result - an agent run's parsed result object
 * @returns {number|null} the headline score, or null if the agent has none
 */
function extractScore(result) {
  if (!result || typeof result !== 'object') return null;

  // Explicit keys win, so existing agents keep their exact current behaviour.
  for (const k of EXPLICIT_KEYS) {
    const n = toScore(result[k]);
    if (n !== null) return n;
  }

  // Otherwise the first *_score key holding a usable number. Object key order
  // follows insertion order, and agents list their score section first, so this
  // picks the headline score rather than a secondary one.
  for (const k of Object.keys(result)) {
    if (!SCORE_KEY_RX.test(k)) continue;
    const n = toScore(result[k]);
    if (n !== null) return n;
  }
  return null;
}

// Accepts 41 and "41" and "41/100"; rejects arrays, objects, booleans, NaN and
// anything outside 0-100 (a stray `_score` field holding a timestamp or a
// currency amount must not end up rendered as a grade).
function toScore(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (Array.isArray(v) || typeof v === 'object') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n;
}

/** Same idea for the verdict line. */
function extractVerdict(result) {
  if (!result || typeof result !== 'object') return null;
  for (const k of ['verdict', 'overall_verdict']) {
    if (typeof result[k] === 'string' && result[k].trim()) return result[k].trim();
  }
  for (const k of Object.keys(result)) {
    if (!/verdict$/.test(k)) continue;
    if (typeof result[k] === 'string' && result[k].trim()) return result[k].trim();
  }
  return null;
}

module.exports = { extractScore, extractVerdict };
