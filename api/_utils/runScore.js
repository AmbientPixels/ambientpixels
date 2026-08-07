// runScore — pull the headline score and verdict out of an agent run result.
//
// WHY THIS EXISTS (2026-08-07): both share endpoints hardcoded
//   result.score ?? result.overall_score
// but only ONE of the ten scoring agents (roast-my-site) actually uses the key
// `score`. The other nine use their own domain key — ats_score, quality_score,
// viability_score, persuasion_score, design_score, standout_score,
// original_score, productivity_score, their_score — so the share card rendered
// with NO SCORE for 9 of 10 scoring agents, silently. The score is the single
// most shareable element of a roast ("I got 41/100"), so this quietly broke the
// viral loop for almost the whole catalogue.
//
// HOW IT RESOLVES A KEY, in order:
//
//   1. The agent's DECLARED schema. Every agent in `_data/pixel-agents.json`
//      already ships an `outputSections` array whose entries carry a `type`:
//        { "key": "ats_score", "label": "ATS Score", "type": "score" }
//      That is authoritative — the UI renders from it — so it beats any guess.
//      It also catches the five verdict keys no pattern match could ever find:
//      cause_of_death, rating, send_confidence, shock_factor, goal_summary.
//   2. The conventional keys `score` / `overall_score`.
//   3. A schema-free scan for a *_score key holding a usable number.
//
// Step 3 is kept deliberately, so an agent that ships without an
// `outputSections` entry — a community agent built in Agent Forge, or a
// registry entry that drifts — still produces a card with a score rather than
// a blank one. Degrading to a good guess beats degrading to nothing.
//
// Shared module rather than duplicated in both endpoints, because a "keep these
// two in sync" comment is exactly how this class of bug comes back.

const fs = require('fs');
const path = require('path');

const EXPLICIT_SCORE_KEYS = ['score', 'overall_score'];
const EXPLICIT_VERDICT_KEYS = ['verdict', 'overall_verdict'];
const SCORE_KEY_RX = /(^|_)score$/;
const VERDICT_KEY_RX = /verdict$/;

// ── the declared schema ────────────────────────────────────────────────

let registryById = null;

// Read once per cold start. A missing or malformed registry must never break
// card rendering — it just means we fall through to the heuristics.
function loadRegistry() {
  if (registryById) return registryById;
  registryById = new Map();
  try {
    const filePath = path.join(__dirname, '..', '_data', 'pixel-agents.json');
    const agents = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (Array.isArray(agents)) {
      for (const a of agents) if (a && a.id) registryById.set(a.id, a);
    }
  } catch { /* heuristics still apply */ }
  return registryById;
}

// `agent` may be an agent object (community agents live in state, not the
// file, so callers pass them straight in), an agent id, or nothing at all.
function resolveAgent(agent) {
  if (typeof agent === 'string') return loadRegistry().get(agent) || null;
  if (agent && typeof agent === 'object' && !Array.isArray(agent)) return agent;
  return null;
}

// Keys the agent itself declares for a given section type, in declared order.
// Order carries meaning: debate-me declares their_score before counter_score,
// and the first one is the headline.
function declaredKeys(agent, type) {
  const resolved = resolveAgent(agent);
  if (!resolved || !Array.isArray(resolved.outputSections)) return [];
  return resolved.outputSections
    .filter(s => s && s.type === type && typeof s.key === 'string')
    .map(s => s.key);
}

// ── extraction ─────────────────────────────────────────────────────────

/**
 * @param {object} result - an agent run's parsed result object
 * @param {object|string} [agent] - the agent, or its id, that produced it
 * @returns {number|null} the headline score, or null if there is none
 */
function extractScore(result, agent) {
  return firstUsable(result, toScore, [
    ...declaredKeys(agent, 'score'),
    ...EXPLICIT_SCORE_KEYS
  ], SCORE_KEY_RX);
}

/**
 * @param {object} result - an agent run's parsed result object
 * @param {object|string} [agent] - the agent, or its id, that produced it
 * @returns {string|null} the verdict line, or null if there is none
 */
function extractVerdict(result, agent) {
  return firstUsable(result, toVerdict, [
    ...declaredKeys(agent, 'verdict'),
    ...EXPLICIT_VERDICT_KEYS
  ], VERDICT_KEY_RX);
}

// Try the preferred keys in order, then any key matching the pattern. A
// preferred key holding junk is skipped rather than treated as final, so a
// model that emits "N/A" in the declared slot still yields a usable card if a
// real number sits elsewhere in the result.
function firstUsable(result, coerce, preferredKeys, patternRx) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;

  for (const k of preferredKeys) {
    const v = coerce(result[k]);
    if (v !== null) return v;
  }
  // Object key order follows insertion order, and agents list their score
  // section first, so this picks the headline rather than a secondary one.
  for (const k of Object.keys(result)) {
    if (!patternRx.test(k)) continue;
    const v = coerce(result[k]);
    if (v !== null) return v;
  }
  return null;
}

// Accepts 41, "41" and "41/100"; rejects arrays, objects, booleans, NaN and
// anything outside 0-100 — a stray `_score` field holding a timestamp or a
// currency amount must never end up rendered as a grade.
function toScore(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (Array.isArray(v) || typeof v === 'object') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n;
}

function toVerdict(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// ── resolving the agent behind a stored run ────────────────────────────

/**
 * Find the agent that produced a stored run, so its declared schema can be used.
 *
 * Agents come from two places: the static file registry, and `pixelAgentCommunity`
 * state for anything built in Agent Forge. The file is checked first because it
 * is free — read once at cold start — and covers the entire built-in catalogue.
 * State is only touched when the file misses, so a normal share card costs no
 * extra blob read.
 *
 * `storage` is injected rather than required directly to keep this module free
 * of a storage dependency and testable without one.
 *
 * @param {object} run - a record from `pixelAgentRuns`
 * @param {{getState: function}} [storage] - the companyStorage module
 * @returns {Promise<object|null>} the agent definition, or null
 */
async function agentForRun(run, storage) {
  if (!run || !run.agentId) return null;

  const fromFile = loadRegistry().get(run.agentId);
  if (fromFile) return fromFile;

  if (!storage || typeof storage.getState !== 'function') return null;
  try {
    const community = (await storage.getState('pixelAgentCommunity')) || [];
    if (!Array.isArray(community)) return null;
    return community.find(a => a && a.id === run.agentId) || null;
  } catch {
    // A share card must render even when state is unreachable; the extractors
    // fall back to their heuristics from here.
    return null;
  }
}

module.exports = { extractScore, extractVerdict, agentForRun };
