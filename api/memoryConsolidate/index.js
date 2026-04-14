// memoryConsolidate — Timer Trigger (daily @ 15:00 UTC)
//
// Self-Awareness Phase 4. Scans agentMemories for clusters of 5+ similar
// entries and collapses them into a single `type: 'consolidated_belief'`
// memory with long TTL (90 days).
//
// Guards:
//   - Never consolidate memories younger than 7 days (might be transient).
//   - Never consolidate memories with source 'auto:experiment-verdict' or
//     'auto:ceo-edit' — these are authoritative single events, not beliefs.
//   - Never consolidate memories of type 'reflection', 'weekly_report', or
//     'consolidated_belief' — already structured / summarizing.
//   - Cap 3 consolidations per agent per day (prevents pathological collapse).
//
// Similarity hash: (type, first 30 chars lowercased + top-3 content words).
// Cheap approximation that avoids needing an LLM call.

const storage = require('../_utils/companyStorage');
const crypto = require('crypto');

const MIN_CLUSTER_SIZE = 5;
const MIN_AGE_DAYS = 7;
const CONSOLIDATED_TTL_DAYS = 90;
const MAX_CONSOLIDATIONS_PER_AGENT_PER_RUN = 3;
const PROTECTED_SOURCES = new Set(['auto:experiment-verdict', 'auto:ceo-edit']);
const PROTECTED_TYPES = new Set(['reflection', 'weekly_report', 'consolidated_belief']);

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
  'with', 'from', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might',
  'i', 'my', 'me', 'we', 'us', 'our', 'it', 'its', 'this', 'that', 'these', 'those',
  'not', 'no', 'as', 'so', 'if', 'than', 'then', 'when', 'where', 'how', 'why'
]);

function topContentWords(text, n) {
  if (!text) return [];
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  const counts = {};
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w || w.length < 3 || STOP_WORDS.has(w)) continue;
    counts[w] = (counts[w] || 0) + 1;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, n);
}

function clusterKey(mem) {
  const type = (mem.type || 'note').toLowerCase();
  const text = String(mem.text || '').toLowerCase().substring(0, 30);
  const top = topContentWords(mem.text || '', 3).join(',');
  return type + '|' + text + '|' + top;
}

function sortDesc(a, b) {
  return Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0);
}

module.exports = async function (context) {
  context.log('[memoryConsolidate] cycle start');
  let memories = {};
  try {
    memories = (await storage.getState('agentMemories')) || {};
  } catch (err) {
    context.log.error('[memoryConsolidate] failed to load agentMemories:', (err && err.message) || err);
    return;
  }

  const now = Date.now();
  const minAgeCutoff = now - (MIN_AGE_DAYS * 24 * 60 * 60 * 1000);
  let totalConsolidations = 0;
  const changedAgents = [];

  for (const agentId of Object.keys(memories)) {
    const list = memories[agentId];
    if (!Array.isArray(list) || list.length < MIN_CLUSTER_SIZE) continue;

    // Candidates: not protected type/source, older than 7 days, has text
    const candidates = list.filter(m => {
      if (!m || !m.text) return false;
      if (PROTECTED_TYPES.has((m.type || '').toLowerCase())) return false;
      if (m.source && PROTECTED_SOURCES.has(m.source)) return false;
      const ts = Date.parse(m.timestamp || 0);
      if (!Number.isFinite(ts)) return false;
      return ts <= minAgeCutoff;
    });

    if (candidates.length < MIN_CLUSTER_SIZE) continue;

    // Cluster by similarity key
    const clusters = {};
    candidates.forEach(m => {
      const k = clusterKey(m);
      if (!clusters[k]) clusters[k] = [];
      clusters[k].push(m);
    });

    // Process qualifying clusters (sort by size desc, cap per agent)
    const eligibleKeys = Object.keys(clusters)
      .filter(k => clusters[k].length >= MIN_CLUSTER_SIZE)
      .sort((a, b) => clusters[b].length - clusters[a].length)
      .slice(0, MAX_CONSOLIDATIONS_PER_AGENT_PER_RUN);

    if (eligibleKeys.length === 0) continue;

    let agentChanged = false;
    for (const ck of eligibleKeys) {
      const cluster = clusters[ck].slice().sort(sortDesc);
      const keeper = cluster[0];
      const oldestTs = cluster[cluster.length - 1].timestamp;
      const consolidatedIds = cluster.map(m => m.id || 'unknown');
      const consolidatedText = 'Consolidated from ' + cluster.length + ' similar entries (earliest: ' +
        String(oldestTs).substring(0, 10) + ', latest: ' + String(keeper.timestamp).substring(0, 10) +
        '). Core belief: ' + String(keeper.text).substring(0, 400);

      const newEntry = {
        id: 'mem-cb-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
        type: 'consolidated_belief',
        text: consolidatedText,
        source: 'auto:consolidation',
        timestamp: new Date().toISOString(),
        expiresAt: new Date(now + (CONSOLIDATED_TTL_DAYS * 24 * 60 * 60 * 1000)).toISOString(),
        evidence: { consolidatedFromIds: consolidatedIds, clusterSize: cluster.length }
      };

      // Remove the source entries; append the consolidated one
      const sourceIdSet = new Set(consolidatedIds);
      memories[agentId] = memories[agentId].filter(m => !(m && sourceIdSet.has(m.id)));
      memories[agentId].push(newEntry);

      totalConsolidations++;
      agentChanged = true;
      context.log('[memoryConsolidate]', agentId, 'consolidated', cluster.length, 'memories. keeper:', (keeper.text || '').substring(0, 60));
    }

    if (agentChanged) changedAgents.push(agentId);
  }

  if (totalConsolidations > 0) {
    try {
      await storage.setState('agentMemories', memories);
      context.log('[memoryConsolidate] cycle complete. consolidations:', totalConsolidations, 'agents affected:', changedAgents.join(', '));
    } catch (err) {
      context.log.error('[memoryConsolidate] failed to save agentMemories:', (err && err.message) || err);
    }
  } else {
    context.log('[memoryConsolidate] cycle complete. consolidations: 0');
  }
};
