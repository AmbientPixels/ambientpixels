// backtest-quality-gate.cjs — Phase A1 of the Full Autonomy Roadmap
// (docs/superpowers/plans/2026-06-10-full-autonomy-roadmap.md)
//
// Replays the content quality gate against every historical social action that has a
// CEO decision, and reports recall on quality-class rejects + false-flag rate on
// approves against the Phase A exit criteria (>=90% recall, <=15% false-flag).
//
// Three gates are replayed per post, mirroring what production runs at creation time:
//   1. LLM QG    — exact replica of _validateContentQuality (api/companyHeartbeat/
//                  agent-runner.js:35). Production auto-reject rule: !pass && confidence>=70
//                  (agent-runner.js:2939).
//   2. semantic_dup — findNearDuplicateSocialPost from helpers.js, replayed chronologically
//                  against only the posts that existed when this one was created.
//   3. campaign_daily_cap — campaignDailyPostCapStatus from helpers.js, same replay. NOTE:
//                  this gate DEFERS (not drops) in production, so on approves it is reported
//                  separately, not counted as a false flag.
//
// Ground-truth labels live in backtest-quality-gate-labels.json (quality vs strategic class
// per reject, with failure mode). Strategic-class rejects (timing, topic, platform policy)
// are excluded from recall — the QG can't and shouldn't catch those.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... node scripts/backtest-quality-gate.cjs [options]
//     --dump <path>        read actions from a JSON dump instead of the live API
//     --out <path>         results JSON (default: backtest-quality-gate-results.json next to script)
//     --concurrency <n>    parallel Anthropic calls (default 4)
//     --skip-llm           deterministic gates only (no API key needed)
//
// Node only (no Python on this machine). Requires ANTHROPIC_API_KEY unless --skip-llm.

const fs = require('fs');
const path = require('path');
const https = require('https');

const HELPERS = path.join(__dirname, '..', 'api', 'companyHeartbeat', 'helpers.js');
const { findNearDuplicateSocialPost, campaignDailyPostCapStatus } = require(HELPERS);
const _productFacts = require(path.join(__dirname, '..', 'api', '_data', 'product-facts.json'));
let _founderVoice = {};
try { _founderVoice = require(path.join(__dirname, '..', 'api', '_data', 'founder-voice-examples.json')); } catch (_) {}
const LABELS = require(path.join(__dirname, 'backtest-quality-gate-labels.json')).labels;

const HOST = 'ambientpixels-nova-api.azurewebsites.net';
const SECRET = 'pixelpusher';
const QG_MODEL = 'claude-haiku-4-5-20251001'; // same model as production
const QG_CONFIDENCE_THRESHOLD = 70;           // production auto-reject rule

// ── CLI ──
const argv = process.argv.slice(2);
function arg(name, dflt) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; }
const DUMP = arg('--dump', null);
const OUT = arg('--out', path.join(__dirname, 'backtest-quality-gate-results.json'));
const CONCURRENCY = parseInt(arg('--concurrency', '4'), 10) || 4;
const SKIP_LLM = argv.includes('--skip-llm');

// ── state fetch (same unwrap pattern as the Phase-1 verify scripts) ──
function getState(key) {
  return new Promise((resolve, reject) => {
    https.get({ host: HOST, path: '/api/company-state?key=' + key, headers: { 'x-company-secret': SECRET } }, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => {
        try {
          const p = JSON.parse(body);
          if (Array.isArray(p)) return resolve(p);
          if (p && Array.isArray(p.value)) return resolve(p.value);
          resolve(p && p.value !== undefined ? p.value : p);
        } catch (e) { reject(new Error('parse fail for ' + key + ': ' + body.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

// ── LLM QG: exact prompt replica of _validateContentQuality (agent-runner.js:35-99) ──
function buildQgPrompt(text, platform) {
  var factsStr = Object.keys(_productFacts.products).map(function (name) {
    var p = _productFacts.products[name];
    return name + ': ' + p.description + '. Features: ' + p.features.join(', ') + '. NOT: ' + p.notThis.join('; ');
  }).join('\n');
  var brandStr = '';
  if (_productFacts.brand) {
    var b = _productFacts.brand;
    var bParts = [];
    if (b.colors) {
      bParts.push('COLORS — isThis: ' + (b.colors.isThis_description || ''));
      bParts.push('COLORS — notThis: ' + (b.colors.notThis || []).join('; '));
    }
    if (b.fonts) {
      bParts.push('FONTS — isThis: ' + (b.fonts.isThis || []).join(', '));
      bParts.push('FONTS — notThis: ' + (b.fonts.notThis || []).join('; '));
    }
    if (b.siteSections) {
      bParts.push('SITE SECTIONS that actually exist: ' + (b.siteSections.isThis || []).join(' | '));
      bParts.push('SITE SECTIONS that do NOT exist (flag if cited): ' + (b.siteSections.notThis || []).join('; '));
    }
    if (b.aestheticDirection) {
      bParts.push('AESTHETIC — isThis: ' + (b.aestheticDirection.isThis || []).join('; '));
      bParts.push('AESTHETIC — notThis: ' + (b.aestheticDirection.notThis || []).join('; '));
    }
    if (b.voice) {
      bParts.push('VOICE bannedPhrases (flag any exact or near-match, case-insensitive): ' + (b.voice.bannedPhrases || []).join('; '));
      bParts.push('VOICE bannedPatterns: ' + (b.voice.bannedPatterns || []).join('; '));
      bParts.push('VOICE isThis: ' + (b.voice.isThis || []).join('; '));
    }
    if (bParts.length) brandStr = '\n\nBRAND FACTS (universal — apply to ALL content regardless of which product is mentioned):\n' + bParts.join('\n');
  }
  var toneBlocklist = (_founderVoice.tone_blocklist || []).join(', ');
  var toneGoodExamples = (_founderVoice.tone_good_examples || []).map(function (e) { return '"' + e + '"'; }).join('\n');
  return 'You are a content quality checker for AmbientPixels. Check this ' + platform + ' post for:\n1. Factual accuracy against the product descriptions below\n2. Hallucinated features or capabilities that do not exist\n3. FABRICATED STATISTICS — any specific numbers, percentages, user counts, ticket counts, accuracy rates, or metrics that are not from the product facts below. If the post cites a specific number (e.g. "37 tickets", "95% accuracy", "10,000 users"), it is almost certainly fabricated and MUST be flagged.\n4. TONE VIOLATIONS — the post MUST match founder voice rules. Flag ANY of these:\n   - Buzzwords or hype from this blocklist: ' + toneBlocklist + '\n   - Rhetorical questions used as hooks ("Ever feel like...?", "Ready to...?", "What if you could...?")\n   - Emoji as opening hooks or emoji walls (single contextual emoji at end is fine)\n   - Em dashes anywhere in the text\n   - Excessive exclamation marks or exclamation marks in corporate-sounding sentences (casual single use like "Shipped it!" in a short line is OK)\n   - Generic AI filler or landscape-setting openers\n   - Reading level too high: long compound sentences, jargon, or SAT words when a simple word exists\n   Good tone examples:\n' + toneGoodExamples + '\n   A post with correct facts but AI-marketing tone MUST fail. Tone violations are as serious as factual errors.\n5. BRAND VIOLATIONS — the post MUST NOT contradict the BRAND FACTS below. Flag ANY of:\n   - Mentions of colors not in the brand isThis palette (e.g. "signal red", or "amber" outside Blindspot)\n   - Mentions of fonts not in the two-font stack (Space Grotesk + Manrope) — any third font name is a hallucination\n   - References to site sections that do not exist (e.g. "manifesto page", "cast page") — only cite sections from the BRAND FACTS siteSections list\n   - Aesthetic descriptors not in isThis (e.g. "dark-native editorial", "notebook", "cel-shaded") — these are hallucinations\n   - ANY voice bannedPhrase (exact or near-match, case-insensitive) — fabricated marketing language\n\nIMPORTANT: List every violation you find. Return all of them in the issues array. Do not stop at the first match.\n\nPRODUCT FACTS:\n' + factsStr + brandStr + '\n\nPOST TO CHECK:\n' + text + '\n\nReturn ONLY raw JSON with no markdown, no preamble, no explanation:\n{"pass": true_or_false, "confidence": 0_to_100, "issues": ["issue1", "issue2"]}';
}

async function callQg(text, platform, apiKey) {
  const body = JSON.stringify({
    model: QG_MODEL,
    max_tokens: 500,
    system: 'You are a JSON-only API. Return ONLY a single raw JSON object with no markdown, no code fences, no preamble, no explanation. The response must start with { and end with }.',
    messages: [{ role: 'user', content: buildQgPrompt(text, platform) }]
  });
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body, signal: controller.signal
      });
      clearTimeout(timer);
      if (resp.status === 429 || resp.status >= 500) {
        const wait = 2000 * attempt;
        process.stderr.write('  [retry] HTTP ' + resp.status + ', waiting ' + wait + 'ms\n');
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!resp.ok) return { error: 'HTTP ' + resp.status };
      const data = await resp.json();
      const rt = (data.content && data.content[0] && data.content[0].text) || '';
      try { return JSON.parse(rt); } catch (_) {}
      const m = rt.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
      return { pass: true, confidence: 0, issues: ['parse error'], _raw: rt.slice(0, 300) };
    } catch (err) {
      if (attempt === 4) return { error: String(err).slice(0, 150) };
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  return { error: 'retries exhausted' };
}

// ── main ──
(async () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !SKIP_LLM) {
    console.error('ANTHROPIC_API_KEY not set (or pass --skip-llm for deterministic gates only)');
    process.exit(1);
  }

  let actions, tasks, tasksArchive, campaigns;
  if (DUMP) {
    const p = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
    actions = Array.isArray(p) ? p : p.value;
    [tasks, tasksArchive, campaigns] = await Promise.all([
      getState('tasks').catch(() => []), getState('tasksArchive').catch(() => []), getState('campaigns').catch(() => [])
    ]);
  } else {
    [actions, tasks, tasksArchive, campaigns] = await Promise.all([
      getState('actions'), getState('tasks').catch(() => []),
      getState('tasksArchive').catch(() => []), getState('campaigns').catch(() => [])
    ]);
  }
  const allTasks = [].concat(Array.isArray(tasks) ? tasks : [], Array.isArray(tasksArchive) ? tasksArchive : []);
  const campaignById = {};
  (Array.isArray(campaigns) ? campaigns : []).forEach(c => { if (c && c.id) campaignById[c.id] = c; });
  const taskById = {};
  allTasks.forEach(t => { if (t && t.id) taskById[t.id] = t; });

  // Backtest population: social posts with text and a terminal CEO decision.
  const social = actions
    .filter(a => a && typeof a.type === 'string' && a.type.indexOf('social_post') === 0)
    .map(a => ({ a, ts: new Date(a.created_at || a.createdAt || 0).getTime() || 0 }))
    .sort((x, y) => x.ts - y.ts);

  const rows = [];
  for (let i = 0; i < social.length; i++) {
    const cur = social[i].a;
    const status = (cur.approval && cur.approval.status) || 'none';
    const text = (cur.payload && cur.payload.text) || (cur.action_payload && cur.action_payload.text) || '';
    const label = LABELS[cur.id] || null;
    const parentTask = cur._parentTaskId ? (taskById[cur._parentTaskId] || null) : null;
    const campaignId = parentTask ? (parentTask.campaign_id || null) : null;
    const campaign = campaignId ? (campaignById[campaignId] || null) : null;
    const now = social[i].ts || Date.now();
    // Creation-time fidelity: a prior whose CEO decision landed AFTER this post was created
    // was still 'pending' when production would have run the gate — the dup gate skips
    // 'rejected' priors (retry-after-reject is allowed), so feeding it today's statuses
    // would underestimate what it catches. Clone priors with their status as of `now`.
    const prior = social.slice(0, i).map(s => {
      const p = s.a;
      const ap = p.approval || {};
      const decidedTs = new Date(ap.decided_at || ap.approved_at || ap.resolvedAt || 0).getTime() || 0;
      const terminal = ['rejected', 'ceo-rejected', 'cancelled', 'approved'].includes(ap.status);
      if (terminal && decidedTs && decidedTs > now) {
        return Object.assign({}, p, { approval: Object.assign({}, ap, { status: 'pending' }) });
      }
      return p;
    });

    // deterministic gates, replayed at this post's creation time
    const dup = text ? findNearDuplicateSocialPost({
      text, platform: cur.platform, campaignId, actions: prior, tasks: allTasks, now
    }) : { isDuplicate: false, similarity: 0 };
    const cap = campaignDailyPostCapStatus({
      campaignId, parentTaskId: cur._parentTaskId || null, platform: cur.platform,
      actions: prior, tasks: allTasks, now,
      frequency: campaign ? campaign.frequency : undefined,
      cadence: campaign ? campaign.cadence : undefined
    });

    rows.push({
      id: cur.id, created_at: cur.created_at || cur.createdAt, platform: cur.platform,
      status, hasText: !!text, textChars: text.length,
      label: label ? label.class : (status === 'rejected' || status === 'ceo-rejected' ? 'UNLABELED' : null),
      mode: label ? label.mode : null, borderline: !!(label && label.borderline),
      decisionNote: (cur.approval && cur.approval.decision_note) ? String(cur.approval.decision_note).slice(0, 200) : null,
      semanticDup: { hit: dup.isDuplicate, similarity: Math.round(dup.similarity * 100) / 100, matchId: dup.matchId || null },
      dailyCap: { hit: cap.exceeded, count: cap.count, cap: cap.cap === Infinity ? null : cap.cap },
      qg: null, _text: text
    });
  }

  // LLM QG calls (only rows with text), small worker pool
  const todo = rows.filter(r => r.hasText);
  if (!SKIP_LLM) {
    console.log('Running LLM QG (' + QG_MODEL + ') on ' + todo.length + ' posts, concurrency ' + CONCURRENCY + ' ...');
    let next = 0, done = 0;
    async function worker() {
      while (next < todo.length) {
        const r = todo[next++];
        const res = await callQg(r._text, r.platform || 'social', apiKey);
        r.qg = res && !res.error ? {
          pass: !!res.pass, confidence: res.confidence || 0,
          flagged: !res.pass && (res.confidence || 0) >= QG_CONFIDENCE_THRESHOLD,
          issues: (res.issues || []).slice(0, 6)
        } : { error: res ? res.error : 'null result' };
        done++;
        if (done % 10 === 0) console.log('  ' + done + '/' + todo.length);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    // Second pass: retry transient API errors sequentially (a 429 burst in the pool is not
    // signal about the gate — production fail-opens on errors, but a backtest wants verdicts).
    const errored = todo.filter(r => r.qg && r.qg.error);
    if (errored.length) {
      console.log('Retrying ' + errored.length + ' errored calls sequentially...');
      for (const r of errored) {
        await new Promise(res => setTimeout(res, 1500));
        const res2 = await callQg(r._text, r.platform || 'social', apiKey);
        if (res2 && !res2.error) {
          r.qg = {
            pass: !!res2.pass, confidence: res2.confidence || 0,
            flagged: !res2.pass && (res2.confidence || 0) >= QG_CONFIDENCE_THRESHOLD,
            issues: (res2.issues || []).slice(0, 6)
          };
        }
      }
    }
  }
  rows.forEach(r => delete r._text);

  // ── metrics ──
  const qualityRejects = rows.filter(r => (r.status === 'rejected' || r.status === 'ceo-rejected') && r.label === 'quality' && r.hasText);
  const strategicRejects = rows.filter(r => (r.status === 'rejected' || r.status === 'ceo-rejected') && r.label === 'strategic' && r.hasText);
  const unlabeled = rows.filter(r => r.label === 'UNLABELED');
  const approves = rows.filter(r => r.status === 'approved' && r.hasText);

  const qgHit = r => !!(r.qg && r.qg.flagged);
  const detHit = r => r.semanticDup.hit || r.dailyCap.hit;
  const anyHit = r => qgHit(r) || detHit(r);

  function pct(n, d) { return d ? Math.round(1000 * n / d) / 10 : 0; }

  const recallQgOnly = pct(qualityRejects.filter(qgHit).length, qualityRejects.length);
  const recallComposite = pct(qualityRejects.filter(anyHit).length, qualityRejects.length);
  const falseFlagQg = pct(approves.filter(qgHit).length, approves.length);

  const byMode = {};
  qualityRejects.forEach(r => {
    const m = r.mode || '?';
    byMode[m] = byMode[m] || { total: 0, qg: 0, dup: 0, cap: 0, any: 0, missedIds: [] };
    byMode[m].total++;
    if (qgHit(r)) byMode[m].qg++;
    if (r.semanticDup.hit) byMode[m].dup++;
    if (r.dailyCap.hit) byMode[m].cap++;
    if (anyHit(r)) byMode[m].any++; else byMode[m].missedIds.push(r.id);
  });

  const summary = {
    ranAt: new Date().toISOString(),
    model: QG_MODEL, confidenceThreshold: QG_CONFIDENCE_THRESHOLD, llmSkipped: SKIP_LLM,
    population: {
      socialActions: rows.length, approved: approves.length,
      qualityRejects: qualityRejects.length, strategicRejects: strategicRejects.length,
      unlabeledRejects: unlabeled.length, noText: rows.filter(r => !r.hasText).length
    },
    metrics: {
      recallQualityClass_qgOnly_pct: recallQgOnly,
      recallQualityClass_composite_pct: recallComposite,
      falseFlagOnApproves_qgOnly_pct: falseFlagQg,
      approvesDeterministicHits: { semanticDup: approves.filter(r => r.semanticDup.hit).length, dailyCapDefer: approves.filter(r => r.dailyCap.hit).length },
      strategicRejectsQgFlagged: strategicRejects.filter(qgHit).length,
      qgErrors: rows.filter(r => r.qg && r.qg.error).length,
      // Parse errors fail-open in production (pass:true, conf:0) — same here, but surfaced
      // because a gate that can't parse its own verdict on a post is a miss in disguise.
      qgParseErrors: rows.filter(r => r.qg && !r.qg.error && (r.qg.issues || []).includes('parse error')).length
    },
    exitCriteria: {
      recallTarget: 90, falseFlagTarget: 15,
      recallMet_composite: recallComposite >= 90,
      recallMet_qgOnly: recallQgOnly >= 90,
      falseFlagMet: falseFlagQg <= 15
    },
    byFailureMode: byMode
  };

  fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));

  // ── report ──
  console.log('\n══ QG BACKTEST — Phase A1 ══');
  console.log(JSON.stringify(summary.population));
  console.log('\nRECALL on quality-class rejects (' + qualityRejects.length + '):');
  console.log('  LLM QG alone (fail @ conf>=' + QG_CONFIDENCE_THRESHOLD + '):  ' + recallQgOnly + '%');
  console.log('  Composite (QG + semantic_dup + daily_cap): ' + recallComposite + '%   [target >=90%]');
  console.log('\nFALSE-FLAG on approves (' + approves.length + '):');
  console.log('  LLM QG alone: ' + falseFlagQg + '%   [target <=15%]');
  console.log('  deterministic on approves: dup=' + summary.metrics.approvesDeterministicHits.semanticDup + ', capDefer=' + summary.metrics.approvesDeterministicHits.dailyCapDefer + ' (cap defers, not drops)');
  console.log('\nPer failure mode (total | qg / dup / cap / any):');
  Object.keys(byMode).forEach(m => {
    const v = byMode[m];
    console.log('  ' + m.padEnd(14) + v.total + ' | ' + v.qg + ' / ' + v.dup + ' / ' + v.cap + ' / ' + v.any + (v.missedIds.length ? '   MISSED: ' + v.missedIds.join(', ') : ''));
  });
  console.log('\nStrategic-class rejects QG-flagged (informational): ' + summary.metrics.strategicRejectsQgFlagged + '/' + strategicRejects.length);
  if (unlabeled.length) console.log('⚠ UNLABELED rejects (excluded from recall): ' + unlabeled.map(r => r.id).join(', '));
  console.log('\nFull results: ' + OUT);
})();
