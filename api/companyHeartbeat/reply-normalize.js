// reply-normalize.js — turn a drafted deliverable into postable reply text.
//
// This was an anonymous closure inside agent-runner's Scribe bluesky-reply
// branch: redefined on every loop iteration, called once, tested by nothing. It
// is also the last thing standing between a model's scaffolding and a public
// post, which is a strange combination.
//
// It lives here so a second writer cannot grow a second normaliser. The
// participation lane (bluesky-participation.js) drafts through the same rails,
// and once the cheap worker drafts inline it will call this too. Two writers
// with two normalisers is how one of them starts shipping "**Reply:**" to
// strangers.
//
// Pure. No I/O, no model, no storage.

'use strict';

const { capitalizeSentences } = require('./helpers');

// agent-runner treats anything shorter than this as "the agent chose not to
// reply". Exported because the drafting briefs have to be written against the
// same number: a brief that says "answer NOTHING TO ADD when you have nothing"
// produces 14 characters, which is NOT a decline, and gets posted verbatim.
const MIN_REPLY_CHARS = 5;

// Bluesky's own cap is 300 graphemes; we stop at 280 to leave headroom.
const MAX_REPLY_CHARS = 280;

// Leading lines that are labels rather than content.
const _LABEL_LINE_RE = /^\*{0,2}\s*(?:to|platform|thread|in\s+reply\s+to|replying\s+to|context|original\s+post)\s*\*{0,2}\s*:/i;
const _DRAFT_HEADER_RE = /^\*{0,2}\s*(?:bluesky\s+)?reply\s+draft\s*\*{0,2}\.?$/i;
const _REPLY_LABEL_RE = /^\*{0,2}\s*reply\s*\*{0,2}\s*:\s*\*{0,2}\s*/i;

// Meta preamble about the artifact itself. Deliberately narrow: the noun must be
// reply/draft/response/post. A general "Here's X:" strip would eat the opening
// clause of "Here's the thing: retries only mask it", which is real reply text.
const _META_PREAMBLE_RE = /^\s*(?:sure[,!.]?\s*)?(?:here(?:'|’)?s|here\s+is|this\s+is)\s+(?:the|my|a)\s+(?:reply|draft|response|post)\s*:?\s*/i;

/**
 * Strip the formatting Scribe sometimes wraps around a reply ("Bluesky Reply
 * Draft", "**To:** @handle", "**Reply:** ...", surrounding quotes).
 * @returns {string}
 */
function stripReplyScaffolding(raw) {
  let t = String(raw == null ? '' : raw).trim();

  const lines = t.split('\n');
  while (lines.length) {
    const ln = lines[0].trim();
    if (ln === '' || _DRAFT_HEADER_RE.test(ln) || _LABEL_LINE_RE.test(ln)) {
      lines.shift();
    } else { break; }
  }
  t = lines.join('\n').trim();

  t = t.replace(_REPLY_LABEL_RE, '');
  t = t.replace(_META_PREAMBLE_RE, '');

  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t.trim();
}

/**
 * @returns {{ok:boolean, text:string, reason:?string}}
 * ok:false means the agent declined — the caller closes the task rather than
 * posting. It must never mean "post this anyway".
 */
function normalizeReplyDraft(raw, opts) {
  const maxChars = (opts && Number.isFinite(opts.maxChars)) ? opts.maxChars : MAX_REPLY_CHARS;
  const stripped = stripReplyScaffolding(raw);
  if (!stripped || stripped.length < MIN_REPLY_CHARS) {
    return { ok: false, text: '', reason: 'declined' };
  }
  // Founder voice writes lowercase; sentence-case it before it goes public.
  return { ok: true, text: capitalizeSentences(stripped).substring(0, maxChars), reason: null };
}

module.exports = {
  normalizeReplyDraft,
  stripReplyScaffolding,
  MIN_REPLY_CHARS,
  MAX_REPLY_CHARS
};
