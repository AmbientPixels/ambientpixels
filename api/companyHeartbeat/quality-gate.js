// quality-gate.js — composed quality verdict (Full Autonomy Roadmap A2+A3, 2026-06-10)
//
// One gate to consult: composes the LLM quality check (_validateContentQuality in
// agent-runner.js) with deterministic checks into a single verdict object
//   { pass, confidence, issues, deterministicFlags }
// so the AQ badge and any future auto-publish path read ONE truth instead of five
// scattered gates. Pure functions only — no state reads, no LLM calls — so the
// backtest harness (scripts/backtest-quality-gate.cjs) replays them offline.
//
// Backtest evidence behind each check (docs/superpowers/specs/2026-06-10-qg-backtest-report.md):
// - repeat-promo URL: 11/12 uncaught dup-class rejects were differently-worded daily
//   repeat-promos of the SAME deep link (similarity 0.13-0.47, 1/day — under both
//   Phase-1 gates). Same URL + platform within 7d is the deterministic tell.
// - leak detectors: refusal-as-payload passed the LLM at conf 100; revision-commentary
//   and '[link to blog post]' placeholders passed at 92-95.
// - claim grounding: ALL 4 LLM false-flags on approved posts were "fabricated statistic"
//   hits on real telemetry numbers. Grounding suppresses those; ungrounded numbers
//   stay a soft flag (v1) because the grounding corpus is only the task chain.

'use strict';

// ── Leak detectors ──────────────────────────────────────────────────────────
// These DETECT what the sanitize chains failed to strip. They run on the final
// post text right before the verdict — a hit means the text must not ship.

var REFUSAL_PATTERNS = [
  // mirror of the index.js auto-post refusal abort (keep in sync)
  /^[\s\S]{0,400}?\b(?:given the (?:ceo'?s? )?directive|i cannot produce|i am unable to (?:complete|fulfill|produce|write)|i refuse to|i will not write)\b/i,
  /^[\s\S]{0,400}?\bcannot (?:complete|fulfill|produce|write) (?:this|the|an?) (?:post|task|request)\b/i,
  // observed leaks the mirror misses (act_1778997614908: "my X post drafts keep getting rejected")
  /\ballowed task types\b/i,                                     // internal policy vocabulary in public copy
  /\bmark(?:ing)? this task as blocked\b/i,
  /\bdrafts? keeps? getting rejected\b/i,
  /\bi can'?t (?:make|write|produce) (?:an? |the |this )?\w{0,12} ?post\b/i
];

var META_LEAK_PATTERNS = [
  // act_1778965218039: "'How much things cost' refined to 'development costs'. CTA is now more active: ..."
  /['"‘’“”][^'"‘’“”]{2,80}['"‘’“”]\s+(?:refined|revised|changed|updated|tightened) to\b/i,
  /\bCTA is now\b/i,
  /\b(?:addressed|incorporat(?:ed|ing)|per) (?:the )?(?:ceo|editor|quill|reviewer)'?s? (?:feedback|notes?|edits?)\b/i,
  /\brevision notes?:/i
];

var PLACEHOLDER_PATTERN = /\[(?:link|url|insert|add|blog|image|img|cta|placeholder|todo)[^\]\n]{0,50}\]/i;

// Agent persona presented as a human voice in PUBLIC copy. The CEO rejected every
// historical instance ("my name is cipher. i handle the money here", "i'm scribe",
// "forge out. going back to it."). "chad here" is the founder and stays legit.
// The sanitize chains strip LEADING self-intros; this catches mid/trailing persona.
var AGENT_PERSONA_PATTERNS = [
  /\b(?:i'?m|my name is|this is)\s+(?:cipher|forge|scribe|echo|nova|quill|pixel|scout)\b/i,
  /\b(?:cipher|forge|scribe|echo|nova|quill|pixel|scout)\s+(?:out|here)[.,!]/i,
  /\bi (?:handle|manage|run) the (?:money|finances|ops|infrastructure) here\b/i
];

// LinkedIn length ceiling — CEO rejection note on act_1775873900346: "Way too long --
// cut by 60%+"; standing guidance is 400-800 chars. 1500 is the generous hard line.
var LINKEDIN_MAX_CHARS = 1500;

function detectContentLeaks(text, platform) {
  var t = String(text || '');
  var refusal = REFUSAL_PATTERNS.some(function (rx) { return rx.test(t); });
  var metaLeak = META_LEAK_PATTERNS.some(function (rx) { return rx.test(t); });
  var placeholder = PLACEHOLDER_PATTERN.test(t);
  var persona = AGENT_PERSONA_PATTERNS.some(function (rx) { return rx.test(t); });
  var overlong = String(platform || '') === 'linkedin' && t.length > LINKEDIN_MAX_CHARS;
  var issues = [];
  if (refusal) issues.push('Refusal/internal-policy text leaked into post payload — this is not publishable copy');
  if (metaLeak) issues.push('Revision/editor commentary leaked into post payload');
  if (placeholder) issues.push('Unfilled placeholder (e.g. "[link to blog post]") left in post copy');
  if (persona) issues.push('Agent persona presented as a person in public copy ("i\'m scribe" / "forge out") — public posts speak as the founder/brand, never as an agent character');
  if (overlong) issues.push('LinkedIn post is ' + t.length + ' chars — hard ceiling is ' + LINKEDIN_MAX_CHARS + ' (aim 400-800). Cut by 60%+');
  return {
    refusal: refusal, metaLeak: metaLeak, placeholder: placeholder, persona: persona, overlong: overlong,
    any: refusal || metaLeak || placeholder || persona || overlong, issues: issues
  };
}

// ── Repeat-promo URL check (queue collapse) ─────────────────────────────────
// Rule: at most ONE undecided (pending-approval) post per deep link per platform
// in the queue at a time. This is exactly the rule the CEO applied in the
// 2026-06-10 curation: 9 same-link posts piled up unapproved → keep 1, curate 8
// as "duplicate/low-distinct promo".
//
// Deliberately NOT a posting-frequency cap: the CEO approved daily same-link
// posts all through early May (Pixel Agents acquisition campaign), so frequency
// of SHIPPED posts is a campaign/cadence decision, not a quality failure. Only
// the unshipped pile-up is redundant — once the pending post is approved or
// rejected, the next same-link post may enter the queue.
//
// Bare root-domain links are exempt (build-in-public posts legitimately link the
// homepage often; the dup/cap gates own that class). execution.status is ignored
// here — a pending post that a premature send attempt marked 'failed' still
// represents the link in the queue.

function _extractDeepLinks(text) {
  var out = [];
  // protocol optional — Bluesky posts often carry bare "ambientpixels.ai/path" links
  var m = String(text || '').match(/(?:https?:\/\/)?(?:www\.)?ambientpixels\.ai\/[^\s)\]>"']+/gi) || [];
  for (var i = 0; i < m.length; i++) {
    var u = m[i].toLowerCase()
      .replace(/^(?:https?:\/\/)?(?:www\.)?/, '')
      .replace(/[?#][^\s]*$/, '')      // strip query (UTMs) + fragment
      .replace(/[.,;:!)\]]+$/, '')     // trailing punctuation glued to the URL
      .replace(/\/+$/, '');            // trailing slash
    // exempt bare root ("ambientpixels.ai") — only paths count as promo targets
    if (u && u !== 'ambientpixels.ai' && out.indexOf(u) === -1) out.push(u);
  }
  return out;
}

function repeatPromoUrlStatus(opts) {
  var EMPTY = { exceeded: false, count: 0, cap: 1, url: null, matchId: null };
  opts = opts || {};
  if (!opts.text || !Array.isArray(opts.actions)) return EMPTY;
  var links = _extractDeepLinks(opts.text);
  if (links.length === 0) return EMPTY;

  var windowDays = (typeof opts.windowDays === 'number') ? opts.windowDays : 14; // staleness bound only
  var cap = (typeof opts.cap === 'number') ? opts.cap : 1;
  var now = (typeof opts.now === 'number') ? opts.now : Date.now();
  var platform = String(opts.platform || '');
  var cutoff = now - windowDays * 24 * 60 * 60 * 1000;

  var best = EMPTY;
  for (var li = 0; li < links.length; li++) {
    var count = 0, matchId = null;
    for (var i = 0; i < opts.actions.length; i++) {
      var a = opts.actions[i];
      if (!a || typeof a.type !== 'string' || a.type.indexOf('social_post') !== 0) continue;
      if (String(a.platform || '') !== platform) continue;
      var st = (a.approval && a.approval.status) || 'pending';
      if (st !== 'pending') continue;                      // only UNDECIDED posts hold the slot
      var ts = a.created_at || a.createdAt || null;
      if (ts) { var tms = new Date(ts).getTime(); if (Number.isFinite(tms) && tms < cutoff) continue; }
      var exLinks = _extractDeepLinks((a.payload && a.payload.text) || (a.action_payload && a.action_payload.text) || '');
      if (exLinks.indexOf(links[li]) !== -1) { count++; if (!matchId) matchId = a.id || null; }
    }
    if (count >= cap && (!best.exceeded || count > best.count)) {
      best = { exceeded: true, count: count, cap: cap, url: links[li], matchId: matchId };
    } else if (!best.exceeded && count > best.count) {
      best = { exceeded: false, count: count, cap: cap, url: links[li], matchId: matchId };
    }
  }
  return best;
}

// ── Claim grounding (A3) ────────────────────────────────────────────────────
// Numbers in copy must trace to the task chain (title/description/comments/
// deliverables/reviewed_copy) or product-facts. Trivial numbers (1-9, years,
// version-ish, parts of URLs) are ignored — the target class is specific stats
// ("37 tickets", "95% accuracy", "10,000 users").

function _normNum(s) { return String(s).replace(/,/g, ''); }

function extractClaimNumbers(text) {
  var t = String(text || '').replace(/https?:\/\/[^\s)\]>"']+/gi, ' '); // URLs out
  var raw = t.match(/\$?\d[\d,]*(?:\.\d+)?%?/g) || [];
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var r = raw[i];
    var hasUnit = /[%$]/.test(r);
    var n = parseFloat(_normNum(r.replace(/[%$]/g, '')));
    if (!Number.isFinite(n)) continue;
    if (!hasUnit && n < 10) continue;                 // small bare numbers: too noisy
    if (!hasUnit && n >= 1900 && n <= 2099 && Number.isInteger(n)) continue; // years
    if (out.indexOf(r) === -1) out.push(r);
  }
  return out;
}

function findUngroundedClaims(text, groundingText) {
  var nums = extractClaimNumbers(text);
  if (nums.length === 0) return { ungrounded: [], grounded: [], checked: 0 };
  var g = _normNum(String(groundingText || ''));
  var ungrounded = [], grounded = [];
  for (var i = 0; i < nums.length; i++) {
    var bare = _normNum(nums[i]).replace(/[%$]/g, '');
    if (g.indexOf(bare) !== -1) grounded.push(nums[i]); else ungrounded.push(nums[i]);
  }
  return { ungrounded: ungrounded, grounded: grounded, checked: nums.length };
}

// Build the grounding corpus from the parent task chain + product facts.
function buildGroundingText(task, productFacts) {
  var parts = [];
  if (task) {
    parts.push(task.title || '', task.description || '', task.reviewed_copy || '');
    (task.comments || []).forEach(function (c) { if (c && c.text) parts.push(c.text); });
    (task.deliverables || []).forEach(function (d) {
      if (typeof d === 'string') parts.push(d);
      else if (d && d.content) parts.push(d.content);
      else if (d && d.text) parts.push(d.text);
    });
  }
  if (productFacts) { try { parts.push(JSON.stringify(productFacts)); } catch (_) {} }
  return parts.join('\n');
}

// ── Composition ─────────────────────────────────────────────────────────────
// llm: result of _validateContentQuality ({pass, confidence, issues}) or null (fail-open).
// LLM "fabricated statistic" issues whose numbers ALL appear in the grounding corpus
// are suppressed — that exact pattern produced 4/4 false flags in the A1 backtest.
// Ungrounded numbers without an LLM flag stay a soft warning (v1).

var STAT_ISSUE_RX = /fabricat|statistic|invent(?:ed|s)?\b|specific (?:number|metric)|unverifi/i;

function composeQualityVerdict(opts) {
  opts = opts || {};
  var llm = opts.llm || null;
  var leaks = opts.leaks || detectContentLeaks(opts.text || '', opts.platform);
  var repeatPromo = opts.repeatPromo || { exceeded: false };
  var grounding = opts.grounding || null; // result of findUngroundedClaims, or null = not checked

  var issues = [];
  var deterministicFlags = {
    refusalLeak: !!leaks.refusal,
    metaLeak: !!leaks.metaLeak,
    placeholder: !!leaks.placeholder,
    agentPersona: !!leaks.persona,
    overlong: !!leaks.overlong,
    repeatPromoUrl: !!repeatPromo.exceeded,
    semanticDup: !!opts.semanticDup,
    dailyCap: !!opts.dailyCap,
    ungroundedClaims: grounding ? grounding.ungrounded : []
  };

  issues = issues.concat(leaks.issues || []);
  // repeat-promo is a creation-time DEFER gate (serialize same-link posts), not a content
  // failure — if the action exists anyway, surface it as information for the AQ badge.
  if (repeatPromo.exceeded) {
    issues.push('Note: a post linking ' + repeatPromo.url + ' is already pending approval on this platform (' +
      (repeatPromo.matchId || 'recent post') + ') — consider deciding that one first.');
  }

  var hardFail = leaks.any;

  // LLM verdict with grounded-stat suppression
  var llmFail = false;
  var llmConfidence = llm ? (llm.confidence || 0) : 0;
  if (llm && llm.pass === false && llmConfidence >= 70) {
    var llmIssues = Array.isArray(llm.issues) ? llm.issues : [];
    var kept = [];
    for (var i = 0; i < llmIssues.length; i++) {
      var iss = String(llmIssues[i] || '');
      if (grounding && STAT_ISSUE_RX.test(iss)) {
        var issNums = extractClaimNumbers(iss);
        var allGrounded = issNums.length > 0 && issNums.every(function (n) {
          return (grounding.grounded || []).indexOf(n) !== -1;
        });
        if (allGrounded) continue; // real telemetry, not fabrication — suppress
      }
      kept.push(iss);
    }
    if (kept.length > 0) { llmFail = true; issues = issues.concat(kept); }
  } else if (llm && Array.isArray(llm.issues) && llm.issues.length) {
    issues = issues.concat(llm.issues); // soft LLM notes (low confidence / passed)
  }

  // Soft warning: ungrounded numbers that the LLM did not flag
  if (!hardFail && !llmFail && grounding && grounding.ungrounded.length > 0) {
    issues.push('Unverified numbers (not found in task chain or product facts): ' +
      grounding.ungrounded.join(', ') + ' — confirm before approving');
  }

  return {
    pass: !hardFail && !llmFail,
    confidence: hardFail ? 100 : llmConfidence,
    issues: issues,
    deterministicFlags: deterministicFlags,
    source: 'composed-v1'
  };
}

module.exports = {
  detectContentLeaks: detectContentLeaks,
  repeatPromoUrlStatus: repeatPromoUrlStatus,
  extractClaimNumbers: extractClaimNumbers,
  findUngroundedClaims: findUngroundedClaims,
  buildGroundingText: buildGroundingText,
  composeQualityVerdict: composeQualityVerdict,
  _extractDeepLinks: _extractDeepLinks
};
