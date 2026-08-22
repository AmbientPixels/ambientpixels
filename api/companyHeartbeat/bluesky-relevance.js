// bluesky-relevance.js — "do we belong in this thread?", deterministically.
//
// The discovery score (bluesky-sensor.js) is recency + engagement + keyword
// intent. It ranks threads by how BUSY they are, which is the right question for
// finding prospects and the wrong one for finding conversations. Measured against
// the real store on 2026-08-08: of the top 14 candidates, 2 were places we had
// anything to say. The rest were politics, third-party news commentary, numbered
// broadcast threads, and one NSFW art post.
//
// The root cause is the keyword search. "build in public" matches "build a better
// world" and "NYCHA as a public developer", which is how a resume-tool company
// ends up one click from replying to a thread about Trump-class battleships.
//
// HIGH PRECISION, LOW RECALL, on purpose. The costs are asymmetric: a missed
// thread costs nothing because another arrives in two hours, while one bad reply
// is attached to the brand permanently. Every ambiguous case refuses.
//
// Deterministic rather than a model call: it is free, instant, reviewable, and
// unlike a fail-open LLM gate it cannot quietly start passing everything. An LLM
// second pass over the survivors is a reasonable later addition; it is not a
// substitute for this.

'use strict';

// Bare "build" and "public" are deliberately absent. Matching them is exactly
// the mistake the keyword search makes.
var DOMAIN_TERMS = [
  // what we make
  'ai agent', 'ai agents', 'llm', 'llms', 'agentic', 'automation', 'automate',
  'vibe coding', 'build in public', 'buildinpublic', 'indie hacker', 'indiehacker',
  'solo founder', 'bootstrap', 'saas', 'side project', 'shipping', 'ship it',
  'codebase', 'refactor', 'deploy', 'developer', 'engineer', 'programming', 'python',
  'prompt', 'claude', 'gpt', 'copilot', 'cursor',
  // who we serve
  'resume', 'résumé', 'cv', 'job search', 'job hunt', 'jobsearch', 'applicant',
  'ats', 'recruiter', 'hiring', 'interview', 'cover letter', 'portfolio',
  'career', 'laid off', 'layoff', 'job application', 'applying for'
];

// Anything political, civic or geopolitical. We have no standing there and the
// downside is unbounded.
//
// Stems carry an explicit \w* (2026-08-22). The trailing \b in this pattern meant
// every truncated stem silently never fired: for "palestinian", the group matches
// "palestin" and then \b has to hold between 'n' and 'i' — both word characters, so
// the boundary fails and the whole alternative is discarded. palestin/fascis/communis/
// militar were dead entries in a safety filter. \w* absorbs the tail so the trailing
// \b lands on a real boundary.
//
// politic\w* added the same day: the list had `senate` and `democrat` but not the word
// "politics" itself, so a Maine Senate primary thread ("he's also got a resume in ME
// politics and knows the drill") cleared the filter and drew a reply — the domain term
// `resume` matched a track record, not a CV. See _hasResumeIntent in prospect-pipeline.js
// for the polysemy half of that same miss.
// NOT in this list, deliberately: candidate/candidates. It is the single most common
// noun in job-search prose ("still actively seeking candidates meeting his
// qualifications" — a parent describing their kid's job hunt) and adding it refused a
// core-domain thread as political. Same reasoning keeps progressive/conservative out:
// "progressive company" is a job-ad cliché. politic\w* alone catches the real cases.
var POLITICS_RE = /\b(trump|biden|obama|harris|maga|republican|democrat\w*|gop|congress\w*|senat(?:e|or|ors)|parliament\w*|election\w*|voter\w*|ballot\w*|administration|white house|supreme court|governor|mayor|nycha|politic\w*|campaign trail|policy|legislation|immigration|abortion|gaza|israel\w*|palestin\w*|ukrain\w*|russia\w*|putin|nato|tariff\w*|deportation|ice raid|militar\w*|battleship|megalomaniac|fascis\w*|communis\w*|woke|patriarch\w*)\b/i;

var NSFW_RE = /(\bnsfw\b|🔞|\bnude|\bporn|\bhentai|\bfetish|\bkink\b|\bxxx\b|onlyfans|monsterfucker|artfuck|\bsmut\b|\berotic)/i;

// Numbered thread openers ("1/5", "2/6"). Broadcast content, not conversation.
var BROADCAST_RE = /^\s*\d{1,2}\s*\/\s*\d{1,2}\b/;

// Meme scaffolding and truncated setups whose payload is an image we cannot read.
var MEME_RE = /(^|\n)\s*(me|them|the person|nobody|everyone|my brain|society)\s*:\s*$/im;

// Hostility, not critique. "the bottleneck is reliability" is analysis we can add
// to; "AI slop shoved into every product" is a fight we lose by entering.
var AI_TERM_RE = /\b(ai|a\.i\.|llm|chatgpt|genai|generative|copilot|agentic|automation)\b/i;
var HOSTILE_RE = /\b(slop|shoved|shoving|forced down|crammed|burnt|burned for no|hype train|bubble|grift|scam|theft|stole|stolen|plagiaris|plagiariz|ruining|ruined|destroying|enshittif|garbage|dogshit|bullshit|sick of|fed up|hate|loathe|soulless|worthless|parasit|techbro|snake oil)\b/i;

// First-person stake, or a direct question. Without one of these it is a
// broadcast, and appearing under a broadcast is worth less than staying out.
var FIRST_PERSON_RE = /\b(i|i'm|im|i've|ive|i'd|my|mine|me|myself|we|we've|our|ours|us|ourselves)\b/i;
var QUESTION_RE = /[?？]/;

// Third-party news commentary: about a named company or executive, with no stake
// of our own in it.
var NEWS_RE = /\b(zuckerberg|musk|altman|bezos|pichai|nadella|meta|openai|anthropic|google|microsoft|apple|amazon|nvidia|tesla)\b/i;
var REPORTED_RE = /\b(admitted|announced|reported|according to|internal meeting|in a statement|sources say|the latest|forecast|analysts?)\b/i;

// Whole-word matchers, built once. Substring matching (lower.indexOf(term)) was
// the original implementation and it was badly wrong: "ats" matched inside
// "cats", so the lane's first live draft was a reply to an International Cat Day
// photo thread. "ui" matched inside "build", which would have re-admitted the
// entire politics-and-architecture problem the domain list exists to stop.
// \b on both ends, and multi-word phrases like "job search" work unchanged.
const _DOMAIN_MATCHERS = DOMAIN_TERMS.map(function (term) {
  return { term: term, re: new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i') };
});

function _words(s) {
  return String(s || '').replace(/https?:\/\/\S+/g, ' ').replace(/[#@]\S+/g, ' ')
    .split(/\s+/).filter(function (w) { return /[a-z]/i.test(w); });
}

/**
 * @returns {{ok:boolean, reason:?string, matched:string[]}}
 * First refusal wins, and the reason is always named — a filter that refuses
 * without saying why is indistinguishable from an empty queue.
 */
function relevanceVerdict(text) {
  var s = (typeof text === 'string') ? text : '';
  var lower = s.toLowerCase();
  var words = _words(s);

  // Safety guards run BEFORE the substance checks. The real NSFW candidate was
  // almost entirely hashtags, so stripping tags left it looking merely "short" —
  // a correct refusal for an accidental reason. A guard that only fires when the
  // post is long enough to reach it is not a guard.
  if (NSFW_RE.test(s)) return { ok: false, reason: 'nsfw', matched: [] };
  if (POLITICS_RE.test(s)) return { ok: false, reason: 'politics', matched: [] };
  if (words.length < 12) return { ok: false, reason: 'too_short', matched: [] };
  if (BROADCAST_RE.test(s)) return { ok: false, reason: 'broadcast_thread', matched: [] };
  if (MEME_RE.test(s) || /:\s*$/.test(s.trim())) return { ok: false, reason: 'low_substance', matched: [] };

  // A wall of tags with barely any prose left once they are stripped.
  var tagCount = (s.match(/#\S+/g) || []).length;
  if (tagCount >= 5 && words.length < tagCount * 3) return { ok: false, reason: 'low_substance', matched: [] };

  if (AI_TERM_RE.test(s) && HOSTILE_RE.test(s)) return { ok: false, reason: 'hostile', matched: [] };

  var matched = _DOMAIN_MATCHERS.filter(function (m) { return m.re.test(s); }).map(function (m) { return m.term; });
  if (!matched.length) return { ok: false, reason: 'no_domain_fit', matched: [] };

  if (NEWS_RE.test(s) && REPORTED_RE.test(s)) return { ok: false, reason: 'third_party_news', matched: matched };

  if (!FIRST_PERSON_RE.test(s) && !QUESTION_RE.test(s)) {
    return { ok: false, reason: 'not_conversational', matched: matched };
  }

  return { ok: true, reason: null, matched: matched };
}

// POLITICS_RE / NSFW_RE / BROADCAST_RE are exported so the roast prospect lane
// (prospect-pipeline.js) refuses the same topics and shapes from its own filter
// rather than growing a second, drifting copy of the lists. One place to add a topic.
module.exports = { relevanceVerdict, DOMAIN_TERMS, POLITICS_RE, NSFW_RE, BROADCAST_RE };
