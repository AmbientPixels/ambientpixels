// Release Watcher — which changed path belongs to which product.
//
// First match wins. Three kinds of rule:
//   product  — a user-facing change to that product (key = api/_data/product-facts.json key)
//   internal — the agent company, the studio, docs, ops: never a public release
//   neutral  — shared support files (css, js, images): ride along, never make a release alone
// A path no rule matches is counted as `unmatched` in the run summary and treated as neutral,
// so a new top-level folder shows up in the numbers instead of silently becoming a release.

'use strict';

const RULES = [
  // ── internal first: these sit inside product-looking folders too ──
  ['internal', /(^|\/)[^/]*\.test\.js$/],
  ['internal', /^(docs|scripts|tools|skills|projects|lab|studio|build|log|templates)\//],
  ['internal', /^api\/(studio|company[^/]*|companyHeartbeat|memoryStack|proposal[^/]*|rewards[^/]*|reflection[^/]*|emergence[^/]*|memory[^/]*|meetings[^/]*|agentic[^/]*|vale[^/]*|valechat|novachat|nova[^/]*|llm[^/]*|keepalive[^/]*|outcome[^/]*|milestone[^/]*|tasks[^/]*|actions[^/]*|auto[^/]*|world[^/]*|telemetry[^/]*|revenue[^/]*|content[^/]*|social[^/]*|engagement[^/]*|inbox[^/]*|productAnalytics[^/]*|sitemap[^/]*|published[^/]*|blog[^/]*|release-watch[^/]*|releaseWatch[^/]*)(\/|$)/],
  ['internal', /^api\/_(data|utils|shared)\//],
  // fleet-side machinery under product-looking names: outreach, promo admin, intake, chat
  ['internal', /^api\/(as-prospect[^/]*|asProspect[^/]*|formIntake[^/]*|discord-interactions|blueskySearch|generate-promo-codes|promo-codes-status|agentchat|approveProposal|documentsExecute|fleetProposalCreate)(\/|$)/],
  ['internal', /^hanson\//],
  ['internal', /^\.gitignore$/],
  ['internal', /^api\/_lib\/(contentEngine|socialCopy|discord|llm|releaseWatch)\//],
  ['internal', /^modules\//],
  ['internal', /^(data|blog)\//],
  ['internal', /^(\.github\/|staticwebapp\.config\.json$|package(-lock)?\.json$|api\/package(-lock)?\.json$|api\/host\.json$|CLAUDE\.md$|TASKS\.md$|README\.md$)/],

  // ── products ──
  ['AmbientScore', /^ambientscore\//],
  ['AmbientScore', /^api\/(as-[^/]+|as[A-Z][^/]*)\//],
  ['AmbientScore', /^api\/_lib\/ambientScore\//],
  ['ResumeRoast', /^resume-roast\//],
  ['ResumeRoast', /^api\/(roast[^/]*|roastRewriteRunner)\//],
  ['ResumeRoast', /^api\/_lib\/roastRewrite\//],
  ['PixelAgents', /^pixel-agents\//],
  ['PixelAgents', /^api\/pixel-agent[^/]*\//],
  ['AgentForge', /^agent-forge\//],
  ['AgentForge', /^api\/agentforge[^/]*\//],
  ['CardForge', /^cardforge\//],
  ['CardForge', /^api\/(cardforge[^/]*|cardshare)\//],
  ['StoryForge', /^storyforge\//],
  ['StoryForge', /^api\/storyforge[^/]*\//],
  ['Blindspot', /^blindspot\//],
  ['Blindspot', /^api\/blindspot[^/]*\//],
  ['Pulse', /^pulse\//],
  ['Pulse', /^api\/pulse[^/]*\//],
  ['AmbientOS', /^ambientos\//],
  ['AmbientOS', /^api\/agentPublicProfile\//],
  ['AmbientPixels', /^(services|video|about|products|help|support|account)\/|^(index|privacy|terms)\.html$/],

  // ── neutral support ──
  ['neutral', /^(css|js|images|downloads|auth|pages|playground|nova-core|api\/_lib)\//],
  ['neutral', /\.(ico|png|jpg|jpeg|webp|svg|gif|woff2?|txt|xml)$/],
];

const NON_PRODUCT = new Set(['internal', 'neutral']);

function classifyPath(file) {
  const p = String(file || '').replace(/\\/g, '/').replace(/^\/+/, '');
  for (const [kind, re] of RULES) if (re.test(p)) return kind;
  return 'unmatched';
}

// → { products: [..], internal: n, neutral: n, unmatched: [paths] }
function productsForFiles(files) {
  const products = new Set();
  const out = { products: [], internal: 0, neutral: 0, unmatched: [] };
  for (const f of files || []) {
    const k = classifyPath(f);
    if (k === 'internal') out.internal++;
    else if (k === 'neutral') out.neutral++;
    else if (k === 'unmatched') { out.neutral++; out.unmatched.push(f); }
    else products.add(k);
  }
  out.products = [...products].sort();
  return out;
}

module.exports = { RULES, NON_PRODUCT, classifyPath, productsForFiles };
