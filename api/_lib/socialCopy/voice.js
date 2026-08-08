// voice.js — the brand voice spec and platform rules, as data.
//
// This text already existed, inline, inside the social_copy task description
// built by companyHeartbeat/agent-runner.js. It lives here so the worker and
// the Scribe path cannot drift apart: there is ONE definition of how we sound.
//
// Keep it small. The entire reason the worker is cheap is that its prompt is
// ~1k tokens instead of the ~11.5k a fleet agent carries.

const BANNED_WORDS = ['supercharge', 'unleash', 'revolutionary', 'thrilled', 'game-changing', 'seamless'];

// Hashtags are the discovery surface on Bluesky. Its Following feed is
// reverse-chronological, so a post with no tags reaches our followers and
// nobody else; custom feeds are the only route to anyone who does not already
// follow us. Measured 2026-08-08 over the last 100 live posts: 1 carried a
// hashtag and 0 carried a real tag facet.
//
// PROVISIONAL LIST. These are picked on general platform knowledge, NOT
// measured. Validate them with the fleet's own blueskyDiscovery.searchBluesky
// ('#tag') and drop any with no real volume behind it. A tag nobody follows is
// decoration that costs characters, and the job-seeker tags in particular are
// thinner on Bluesky than they are on LinkedIn.
const APPROVED_TAGS = [
  'buildinpublic', 'AI', 'TechSky',           // builder/tech side
  'jobsearch', 'hiring', 'resume', 'careers'  // job-seeker side
];

const VOICE_RULES = [
  'Founder voice, not corporate: casual, proper sentence case (capitalize the first word of every sentence and the pronoun "I").',
  'Short paragraphs. One idea per line.',
  'No em dashes. No double hyphens.',
  'No buzzwords: ' + BANNED_WORDS.join(', ') + '.',
  'No rhetorical question hooks.',
  '5th grade reading level.',
  'Lead with specifics, not adjectives. Vulnerability beats polish.',
  'No markdown, no headers, no internal notes, no "Post 1/Post 2" labels.',
  'Hashtags: use only these and never invent one: ' + APPROVED_TAGS.map(t => '#' + t).join(' ')
    + '. Bluesky 2 to 3, LinkedIn 3, X at most 1, Reddit none. A tag nobody follows reaches nobody.'
].join('\n- ');

// maxTags is enforced by validate.js, not just suggested here. A small model
// asked for "2 to 3" will occasionally produce nine, and tag spam is a ranking
// penalty on every one of these platforms rather than a boost.
const PLATFORM_RULES = {
  social_bluesky: { maxLen: 300, maxTags: 3, guidance: 'One short post. Every character counts; lead with the specific. Use 2 to 3 hashtags: on Bluesky they are how anyone who does not follow us finds the post at all.' },
  social_x: { maxLen: 280, maxTags: 1, guidance: 'One short post. Every character counts; lead with the specific. At most ONE hashtag; more reads as spam here.' },
  social_linkedin: { maxLen: 1500, maxTags: 3, guidance: 'Aim for 800-1500 chars. Write like a short article: narrative hook, short paragraphs, personal voice, clear takeaway. NOT a compressed ad tagline. Close with 3 hashtags.' }
};

// Returns null for unknown platforms on purpose. A default of 280 would
// silently truncate a LinkedIn post into a stub, and the caller must be able
// to tell "I do not handle this" from "here is a cap".
function platformRule(platform) {
  if (!platform || typeof platform !== 'string') return null;
  return PLATFORM_RULES[platform] || null;
}

module.exports = { VOICE_RULES, PLATFORM_RULES, BANNED_WORDS, APPROVED_TAGS, platformRule };
