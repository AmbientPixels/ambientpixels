const fs = require('fs');
const path = require('path');
const https = require('https');
const storage = require('../_utils/companyStorage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

const VALID_LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
const REDACT_KEY_RE = /token|secret|key|authorization|password/i;

function toIsoOrNull(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts).toISOString();
}

function parseLayer(raw) {
  const v = String(raw || '').trim().toUpperCase();
  return VALID_LAYERS.indexOf(v) !== -1 ? v : '';
}

function parseView(raw) {
  const v = String(raw || 'meta').trim().toLowerCase();
  return v === 'summary' || v === 'full' ? v : 'meta';
}

function parseRedact(raw) {
  if (raw === undefined || raw === null || raw === '') return true;
  const v = String(raw).trim();
  return !(v === '0' || v.toLowerCase() === 'false');
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function redactValue(value) {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (REDACT_KEY_RE.test(k)) {
      out[k] = '***REDACTED***';
    } else {
      out[k] = redactValue(value[k]);
    }
  }
  return out;
}

function approxBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value || null), 'utf8');
  } catch (_) {
    return 0;
  }
}

function parseAgentConfigAgents(raw) {
  const list = Array.isArray(raw)
    ? raw
    : (raw && Array.isArray(raw.agents) ? raw.agents : []);
  return list;
}

function buildAgentsDisplay(agentDefs) {
  return agentDefs
    .map((a) => String((a && (a.name || a.id)) || '').trim())
    .filter(Boolean);
}

function readJsonFromCandidates(candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    try {
      const stat = fs.statSync(p);
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { data: data, mtimeMs: stat.mtimeMs, path: p };
    } catch (_) { /* try next */ }
  }
  return { data: null, mtimeMs: null, path: '' };
}

function fetchJson(url) {
  return new Promise((resolve) => {
    try {
      const req = https.get(url, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve({ data: null, mtimeMs: null, path: '' });
            return;
          }
          try {
            resolve({ data: JSON.parse(raw), mtimeMs: null, path: url });
          } catch (_) {
            resolve({ data: null, mtimeMs: null, path: '' });
          }
        });
      });
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ data: null, mtimeMs: null, path: '' });
      });
      req.on('error', () => resolve({ data: null, mtimeMs: null, path: '' }));
    } catch (_) {
      resolve({ data: null, mtimeMs: null, path: '' });
    }
  });
}

function latestTsFromTextMap(mapObj) {
  if (!mapObj || typeof mapObj !== 'object') return null;
  let latest = 0;
  const keys = Object.keys(mapObj);
  for (let i = 0; i < keys.length; i++) {
    const v = mapObj[keys[i]];
    if (!v) continue;
    if (typeof v === 'object') {
      const ts = Date.parse(v.updatedAt || v.updated_at || v.timestamp || v.createdAt || '');
      if (Number.isFinite(ts)) latest = Math.max(latest, ts);
    }
  }
  return latest > 0 ? latest : null;
}

function latestTsFromArray(arr) {
  if (!Array.isArray(arr)) return null;
  let latest = 0;
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i] || {};
    const ts = Date.parse(item.updatedAt || item.updated_at || item.timestamp || item.createdAt || item.created_at || '');
    if (Number.isFinite(ts)) latest = Math.max(latest, ts);
  }
  return latest > 0 ? latest : null;
}

function buildLayerRecords(data) {
  const now = Date.now();

  const staticTs = data.companyAgentsMtime || null;
  const seedMem = data.agentSeedMemories || {};
  const runMem = data.agentMemories || {};
  const wsMem = Array.isArray(data.workspaceMemory) ? data.workspaceMemory : [];
  const runtimeMemory = data.runtimeMemory || {};
  const digest = data.siteDigest || null;

  const runtimeLatest = Math.max(
    Date.parse((runtimeMemory.socialIntel && runtimeMemory.socialIntel.asOfUtc) || '') || 0,
    latestTsFromArray(runMem.nova || []),
    latestTsFromArray(runMem.echo || []),
    latestTsFromArray(runMem.cipher || []),
    latestTsFromArray(runMem.pixel || []),
    latestTsFromArray(runMem.forge || []),
    latestTsFromArray(runMem.scribe || []),
    latestTsFromArray(runMem.quill || []),
    latestTsFromArray(runMem.scout || []),
    latestTsFromTextMap(runMem) || 0
  ) || null;

  const l6Ts = Date.parse((digest && digest.generatedAt) || '') || data.siteDigestMtime || null;

  const records = {
    L1: {
      id: 'L1',
      name: 'Personality',
      source: 'static',
      scope: 'per-agent',
      payload: {
        agents: data.agentDefs.map((a) => ({ id: a.id || '', name: a.name || a.id || '', hasPrompt: !!a.systemPrompt }))
      },
      agentMap: data.agentDefs.reduce((acc, a) => {
        const key = String(a.id || '').toLowerCase();
        if (!key) return acc;
        acc[key] = { id: a.id || key, name: a.name || key, hasPrompt: !!a.systemPrompt, promptPreview: String(a.systemPrompt || '').slice(0, 240) };
        return acc;
      }, {}),
      agentsCovered: data.agentDefs.filter((a) => !!a.systemPrompt).length,
      lastUpdatedAt: toIsoOrNull(staticTs),
      sizeBytes: approxBytes(data.agentDefs.map((a) => a.systemPrompt || '')),
      status: 'ok',
      staleThresholdMs: null,
      description: 'Base agent voice/personality from company-agents.json',
      order: '1/6',
      sourcePath: data.agentsSourcePath || ''
    },
    L2: {
      id: 'L2',
      name: 'Operating Doctrine',
      source: 'static',
      scope: 'per-agent',
      payload: {
        agents: data.agentDefs.map((a) => ({ id: a.id || '', name: a.name || a.id || '', hasDoctrine: !!a.operatingDoctrine }))
      },
      agentMap: data.agentDefs.reduce((acc, a) => {
        const key = String(a.id || '').toLowerCase();
        if (!key) return acc;
        acc[key] = a.operatingDoctrine || null;
        return acc;
      }, {}),
      agentsCovered: data.agentDefs.filter((a) => !!a.operatingDoctrine).length,
      lastUpdatedAt: toIsoOrNull(staticTs),
      sizeBytes: approxBytes(data.agentDefs.map((a) => a.operatingDoctrine || null)),
      status: 'ok',
      staleThresholdMs: null,
      description: 'Strategic doctrine layer that biases decisions per agent',
      order: '2/6',
      sourcePath: data.agentsSourcePath || ''
    },
    L3: {
      id: 'L3',
      name: 'Seed Memories',
      source: 'blob',
      scope: 'mixed',
      payload: seedMem,
      agentMap: seedMem,
      agentsCovered: Object.keys(seedMem).filter((k) => k !== '_global' && String(seedMem[k] || '').trim()).length,
      lastUpdatedAt: toIsoOrNull(latestTsFromTextMap(seedMem)),
      sizeBytes: approxBytes(seedMem),
      status: approxBytes(seedMem) > 2 ? 'ok' : 'empty',
      staleThresholdMs: null,
      description: 'CEO-curated seed memory (_global + per-agent)',
      order: '3/6',
      sourcePath: 'blob:agentSeedMemories'
    },
    L4: {
      id: 'L4',
      name: 'Runtime Memories',
      source: 'blob',
      scope: 'mixed',
      payload: {
        agentMemories: runMem,
        runtimeMemory: runtimeMemory
      },
      agentMap: runMem,
      agentsCovered: Object.keys(runMem).filter((k) => Array.isArray(runMem[k]) && runMem[k].length > 0).length,
      lastUpdatedAt: toIsoOrNull(runtimeLatest),
      sizeBytes: approxBytes({ agentMemories: runMem, runtimeMemory: runtimeMemory }),
      status: 'ok',
      staleThresholdMs: 2 * 60 * 60 * 1000,
      description: 'Live runtime memory buffers (agentMemories + runtimeMemory)',
      order: '4/6',
      sourcePath: 'blob:agentMemories+runtimeMemory'
    },
    L5: {
      id: 'L5',
      name: 'CEO Notes',
      source: 'blob',
      scope: 'global',
      payload: wsMem,
      agentMap: null,
      agentsCovered: data.agentDefs.length,
      lastUpdatedAt: toIsoOrNull(latestTsFromArray(wsMem)),
      sizeBytes: approxBytes(wsMem),
      status: wsMem.length > 0 ? 'ok' : 'empty',
      staleThresholdMs: null,
      description: 'Workspace notes and pinned CEO context',
      order: '5/6',
      sourcePath: 'blob:workspaceMemory'
    },
    L6: {
      id: 'L6',
      name: 'Site Digest',
      source: 'file',
      scope: 'global',
      payload: digest,
      agentMap: null,
      agentsCovered: data.agentDefs.length,
      lastUpdatedAt: toIsoOrNull(l6Ts),
      sizeBytes: approxBytes(digest),
      status: digest ? 'ok' : 'empty',
      staleThresholdMs: 24 * 60 * 60 * 1000,
      description: 'Generated site manifest digest injected at tail of prompt',
      order: '6/6',
      sourcePath: data.digestSourcePath || ''
    }
  };

  const keys = Object.keys(records);
  for (let i = 0; i < keys.length; i++) {
    const r = records[keys[i]];
    if (r.id === 'L4') {
      if (r.sizeBytes <= 2) {
        r.status = 'empty';
      } else {
        const ts = Date.parse(r.lastUpdatedAt || '');
        r.status = (!Number.isFinite(ts) || (now - ts) > r.staleThresholdMs) ? 'stale' : 'ok';
      }
      continue;
    }
    if (r.id === 'L6') {
      if (!r.payload) {
        r.status = 'empty';
      } else {
        const ts = Date.parse(r.lastUpdatedAt || '');
        r.status = (!Number.isFinite(ts) || (now - ts) > r.staleThresholdMs) ? 'stale' : 'ok';
      }
      continue;
    }
    if (r.source === 'file') {
      r.status = 'ok';
    }
  }

  return records;
}

function buildAgentSizes(layer) {
  if (!layer.agentMap || typeof layer.agentMap !== 'object') return null;
  var keys = Object.keys(layer.agentMap);
  if (!keys.length) return null;
  return keys.map(function (k) {
    return { agent: k, bytes: approxBytes(layer.agentMap[k]) };
  });
}

function buildLayerMeta(r) {
  return {
    id: r.id,
    name: r.name,
    source: r.source,
    scope: r.scope,
    agentsCovered: r.agentsCovered,
    lastUpdatedAt: r.lastUpdatedAt,
    sizeBytes: r.sizeBytes,
    status: r.status,
    staleThresholdMs: r.staleThresholdMs || null,
    sourcePath: r.sourcePath || '',
    agentSizes: buildAgentSizes(r)
  };
}

function buildSummaryPayload(layer, agentId) {
  const sourcePayload = agentId && layer.agentMap ? layer.agentMap[agentId] : layer.payload;
  if (sourcePayload === undefined || sourcePayload === null) {
    return { topLevelKeys: [], approxBytes: 0, hasData: false };
  }
  if (Array.isArray(sourcePayload)) {
    return {
      topLevelKeys: ['[array]'],
      approxBytes: approxBytes(sourcePayload),
      hasData: sourcePayload.length > 0,
      length: sourcePayload.length
    };
  }
  if (typeof sourcePayload === 'object') {
    const keys = Object.keys(sourcePayload);
    const keySizes = keys.map((k) => ({ key: k, approxBytes: approxBytes(sourcePayload[k]) }));
    return {
      topLevelKeys: keys,
      approxBytes: approxBytes(sourcePayload),
      hasData: keys.length > 0,
      keySizes: keySizes
    };
  }
  return {
    topLevelKeys: ['[scalar]'],
    approxBytes: approxBytes(sourcePayload),
    hasData: true,
    valueType: typeof sourcePayload
  };
}

async function loadLayerSources() {
  let agentsFile = readJsonFromCandidates([
    path.resolve(__dirname, '../../data/company-agents.json'),
    path.resolve(__dirname, '../data/company-agents.json'),
    path.resolve(process.cwd(), 'data/company-agents.json')
  ]);

  let digestFile = readJsonFromCandidates([
    path.resolve(__dirname, '../../data/site-manifest.digest.json'),
    path.resolve(__dirname, '../data/site-manifest.digest.json'),
    path.resolve(process.cwd(), 'data/site-manifest.digest.json')
  ]);

  if (!agentsFile.data) {
    agentsFile = await fetchJson('https://ambientpixels.ai/data/company-agents.json');
  }

  if (!digestFile.data) {
    digestFile = await fetchJson('https://ambientpixels.ai/data/site-manifest.digest.json');
  }

  const companyAgents = parseAgentConfigAgents(agentsFile.data || []);
  const companyAgentsMtime = agentsFile.mtimeMs || null;
  const siteDigest = digestFile.data || null;
  const siteDigestMtime = digestFile.mtimeMs || null;

  const agentSeedMemories = (await storage.getState('agentSeedMemories')) || {};
  const agentMemories = (await storage.getState('agentMemories')) || {};
  const workspaceMemory = (await storage.getState('workspaceMemory')) || [];
  const runtimeMemory = (await storage.getState('runtimeMemory')) || {};

  return {
    agentDefs: companyAgents,
    companyAgentsMtime,
    agentsSourcePath: agentsFile.path || '',
    siteDigest,
    siteDigestMtime,
    digestSourcePath: digestFile.path || '',
    agentSeedMemories,
    agentMemories,
    workspaceMemory,
    runtimeMemory
  };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS, body: '' };
    return;
  }

  if (req.method !== 'GET') {
    context.res = { status: 405, headers: CORS, body: { error: 'Method not allowed' } };
    return;
  }

  // Demo mode: skip auth (no SWA auth or secret in demo)
  if (process.env.DEMO_MODE !== 'true') {
    const secret = (req.headers && req.headers['x-company-secret']) || '';
    const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
    if (!storage.validateSecret(secret) && !principal) {
      context.res = { status: 403, headers: CORS, body: { error: 'Unauthorized' } };
      return;
    }
  }

  try {
    const q = req.query || {};
    const layerId = parseLayer(q.layer);
    const view = parseView(q.view);
    const agentId = String(q.agent_id || '').trim().toLowerCase();
    const redact = parseRedact(q.redact);

    const loaded = await loadLayerSources();
    const records = buildLayerRecords(loaded);
    const agents = buildAgentsDisplay(loaded.agentDefs);

    const responseMeta = {
      asOfUtc: new Date().toISOString(),
      mode: 'real'
    };

    if (!layerId || view === 'meta') {
      const layers = VALID_LAYERS.map((id) => buildLayerMeta(records[id]));
      context.res = {
        status: 200,
        headers: CORS,
        body: {
          meta: responseMeta,
          layers: layers,
          agents: agents
        }
      };
      return;
    }

    const layer = records[layerId];
    if (!layer) {
      context.res = { status: 400, headers: CORS, body: { error: 'Invalid layer' } };
      return;
    }

    if (agentId && layer.scope === 'global') {
      context.res = { status: 400, headers: CORS, body: { error: 'agent_id not supported for this layer' } };
      return;
    }

    const rawPayload = (agentId && layer.agentMap)
      ? layer.agentMap[agentId]
      : layer.payload;

    const payload = redact ? redactValue(deepClone(rawPayload)) : deepClone(rawPayload);
    const summary = buildSummaryPayload(layer, agentId);

    context.res = {
      status: 200,
      headers: CORS,
      body: {
        meta: responseMeta,
        layer: {
          id: layer.id,
          name: layer.name,
          source: layer.source,
          scope: layer.scope,
          status: layer.status,
          lastUpdatedAt: layer.lastUpdatedAt,
          sizeBytes: layer.sizeBytes,
          injectionOrder: layer.order,
          description: layer.description,
          staleThresholdMs: layer.staleThresholdMs || null,
          sourcePath: layer.sourcePath || ''
        },
        agent_id: agentId || null,
        view: view,
        summary: summary,
        payload: view === 'full' ? payload : undefined
      }
    };
  } catch (err) {
    context.log.error('[memory-stack] error:', err && err.message ? err.message : err);
    context.res = {
      status: 500,
      headers: CORS,
      body: { error: 'Failed to load memory stack', details: err && err.message ? err.message : String(err) }
    };
  }
};
