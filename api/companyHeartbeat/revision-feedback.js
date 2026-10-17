// revision-feedback.js — pure helpers for CEO revisions on publish_document actions.
// No network, no storage: safe to require in tests. index.js wires these into the
// revision safety net and the promote step.

// What the CEO's note asks for. Image-only feedback ("we need a hero image for this")
// goes to Design alone, so the article is not rewritten. Anything that also reads like a
// text change — or that doesn't mention the image at all — still goes to the writer:
// when unsure, do both rather than drop a text request.
var IMAGE_CUE = /hero|imag|imge|picture|photo|illustrat|visual|graphic|artwork|thumbnail/i;
var TEXT_CUE = /rewrit|re-writ|reword|rephras|\btone\b|\bvoice\b|intro|opening|headline|title|paragraph|\bcopy\b|section|shorten|shorter|longer|expand|\bcut\b|\btrim|typo|grammar|spelling|\bcta\b|call to action|\blinks?\b|\bfacts?\b|\bclaims?\b|wording|sentence|\bwords?\b|\bedit|clarif|jargon|ending|conclusion|summary|\btext\b|writing/i;

function classify(note) {
  var s = String(note || '');
  var image = IMAGE_CUE.test(s);
  var text = !image || TEXT_CUE.test(s);
  return { image: image, text: text, imageOnly: image && !text };
}

// The rewrite to promote from a done revision task: the assignee's last deliverable,
// sanitized. Returns { text } or { blocked: 'no-deliverable' | 'placeholders' | 'too-short' }.
function revisionText(task) {
  var deliverables = ((task && task.comments) || []).filter(function (c) {
    return c.type === 'deliverable' && c.author === task.assignee && c.text && c.text.length > 50;
  });
  if (deliverables.length === 0) return { blocked: 'no-deliverable' };
  var t = deliverables[deliverables.length - 1].text;
  // Sanitize meta-commentary tails (mirrors agent-runner.js revise-action handler)
  t = t.replace(/\n*\*{0,2}(?:Notes|Revision Notes|Editor'?s? Notes?|Changes? Made|Revisions?|Internal Notes?|Keywords)\*{0,2}:?\*{0,2}\s*\n[\s\S]*$/i, '').trim();
  t = t.replace(/\n*(?:Artifact ID|Parent task ID|Document ID|Task ID|Campaign ID|Objective ID)[:\s][^\n]*/gi, '').trim();
  t = t.replace(/\s*\[(?:ADDRESSED|NOTE|REVISED|FEEDBACK|CHANGED|UPDATED)(?::\s*[^\]]*)?(?:\]\.?\s*)/gi, ' ').trim();
  // Drop image markdown pointing at a site-relative path: agents cannot put files on the site,
  // so these are invented (e.g. /images/blog/<slug>-hero.png, a 404). The real hero rides on
  // hero_image_asset_id.
  t = t.replace(/^[ \t]*!\[[^\]]*\]\(\/[^)]*\)[ \t]*\r?\n?/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  // Placeholder bracket gate (mirrors agent-runner.js revise-action handler)
  if (/\[(?:[^\]]*(?:mention|insert|\badd\b|include|TBD|link|placeholder|url|website|your |e\.g\.|fill))[^\]]*\]/i.test(t)) return { blocked: 'placeholders' };
  if (t.length < 100) return { blocked: 'too-short' };
  return { text: t };
}

module.exports = { classify: classify, revisionText: revisionText };
