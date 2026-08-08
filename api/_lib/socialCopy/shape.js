// shape.js — decides what KIND of post a social task becomes. Pure: no I/O.
//
// Until 2026-08-08 every scheduled post had one shape: prose + product link —
// the single most demoted shape on X and LinkedIn (195 posts, 65 interactions,
// 79-89% zero engagement). The CEO-approved mix is 2 no-link engagement posts
// per 1 link post, per campaign per platform, with the engagement variant
// following the campaign: build-in-public asks questions, Resume Roast makes
// a craft point.
//
// The decision is made ONCE per social task (at the Scribe copy-brief site in
// agent-runner.js) and persisted as task.post_shape so the downstream URL
// gates can tell "no link by design" from "the model dropped the link".

const DEFAULT_PROFILE = {
  engagementVariants: ['craft_point', 'question'],
  linkEvery: 3   // every 3rd post carries the link — the 2:1 ratio
};

const VARIANT_GUIDANCE = {
  question: 'End with ONE genuine question you actually want answers to. Ask about the reader\'s experience, not about our product. No rhetorical bait.',
  craft_point: 'Make ONE specific, useful point the reader can apply today. Lead with the specific, not the theme.',
  build_note: 'Share ONE concrete thing from building this company: what was built, what broke, or what it cost. Real numbers only.'
};

// djb2 — deterministic so the same task always picks the same variant, which
// keeps retries stable and tests honest. Math.random would break both.
function _hash(s) {
  let h = 5381;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * @param {object} opts
 *   opts.profile     campaign.shapeProfile (optional; defaults apply)
 *   opts.recentKinds prior shape kinds for this campaign+platform, oldest first
 *   opts.seed        stable string (the task id) for the variant pick
 * @returns {{kind:'link'}|{kind:'engagement',variant:string}} plus decidedAt
 */
function pickPostShape(opts) {
  opts = opts || {};
  const p = opts.profile || {};
  const variants = (Array.isArray(p.engagementVariants) && p.engagementVariants.length)
    ? p.engagementVariants : DEFAULT_PROFILE.engagementVariants;
  // Number.isFinite, not ||: linkEvery 0 legitimately means "never link".
  const linkEvery = Number.isFinite(p.linkEvery) ? p.linkEvery : DEFAULT_PROFILE.linkEvery;
  const recent = Array.isArray(opts.recentKinds) ? opts.recentKinds : [];

  let kind = 'engagement';
  if (linkEvery === 1) {
    kind = 'link';
  } else if (linkEvery > 1) {
    const windowKinds = recent.slice(-(linkEvery - 1));
    const dueForLink = windowKinds.length === (linkEvery - 1)
      && windowKinds.every(function (k) { return k === 'engagement'; });
    if (dueForLink) kind = 'link';
  }

  if (kind === 'link') return { kind: 'link', decidedAt: new Date().toISOString() };
  const variant = variants[_hash(opts.seed) % variants.length];
  return { kind: 'engagement', variant: variant, decidedAt: new Date().toISOString() };
}

// History for the rotation, extracted from the live tasks array. Archived
// tasks age out of this — acceptable, the rotation window is only
// (linkEvery - 1) entries deep.
function shapeKindsFromTasks(tasks, campaignId, taskType) {
  return (Array.isArray(tasks) ? tasks : [])
    .filter(function (t) {
      return t && !t._revision_superseded && t.campaign_id === campaignId
        && t.taskType === taskType && t.post_shape && t.post_shape.kind;
    })
    .sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); })
    .map(function (t) { return t.post_shape.kind; });
}

// The brief lines that replace "MUST include the product URL" for engagement
// posts. The override sentence out-ranks campaign descriptions that still
// mandate a URL (camp-resume-roast-launch does until the data task updates it).
function engagementBriefLines(variant) {
  const guidance = VARIANT_GUIDANCE[variant] || VARIANT_GUIDANCE.craft_point;
  return '- THIS IS A NO-LINK ENGAGEMENT POST. Do NOT include any URL. Do NOT name or pitch any product. No call to action. This rule OVERRIDES any campaign rule about including a URL.\n'
    + '- ' + guidance + '\n'
    + '- Truth rule: only say things that are true — evergreen craft advice or numbers we have actually measured. NEVER invent an anecdote, a statistic, or a customer.\n';
}

module.exports = { pickPostShape, shapeKindsFromTasks, engagementBriefLines, DEFAULT_PROFILE, VARIANT_GUIDANCE };
