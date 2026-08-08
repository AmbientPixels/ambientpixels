// voice.js — the brand voice spec and platform rules, as data.
//
// This text already existed, inline, inside the social_copy task description
// built by companyHeartbeat/agent-runner.js. It lives here so the worker and
// the Scribe path cannot drift apart: there is ONE definition of how we sound.
//
// Keep it small. The entire reason the worker is cheap is that its prompt is
// ~1k tokens instead of the ~11.5k a fleet agent carries.

const BANNED_WORDS = ['supercharge', 'unleash', 'revolutionary', 'thrilled', 'game-changing', 'seamless'];

const VOICE_RULES = [
  'Founder voice, not corporate: casual, proper sentence case (capitalize the first word of every sentence and the pronoun "I").',
  'Short paragraphs. One idea per line.',
  'No em dashes. No double hyphens.',
  'No buzzwords: ' + BANNED_WORDS.join(', ') + '.',
  'No rhetorical question hooks.',
  '5th grade reading level.',
  'Lead with specifics, not adjectives. Vulnerability beats polish.',
  'No markdown, no headers, no internal notes, no "Post 1/Post 2" labels.'
].join('\n- ');

const PLATFORM_RULES = {
  social_bluesky: { maxLen: 300, guidance: 'One short post. Every character counts; lead with the specific.' },
  social_x: { maxLen: 280, guidance: 'One short post. Every character counts; lead with the specific.' },
  social_linkedin: { maxLen: 1500, guidance: 'Aim for 800-1500 chars. Write like a short article: narrative hook, short paragraphs, personal voice, clear takeaway. NOT a compressed ad tagline.' }
};

// Returns null for unknown platforms on purpose. A default of 280 would
// silently truncate a LinkedIn post into a stub, and the caller must be able
// to tell "I do not handle this" from "here is a cap".
function platformRule(platform) {
  if (!platform || typeof platform !== 'string') return null;
  return PLATFORM_RULES[platform] || null;
}

module.exports = { VOICE_RULES, PLATFORM_RULES, BANNED_WORDS, platformRule };
