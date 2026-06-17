// test-capitalize-longform.cjs — unit tests for helpers.capitalizeSentencesLongform.
//
// Blog/long-form drafts arrive from the founder-voice agents in all-lowercase
// ("hey everyone, it's chad here. today i want to talk..."). The social path
// already runs capitalizeSentences(); long-form had no net, so lowercase prose
// shipped to /blog/. This is the markdown-aware net applied on the publish path
// (publishDocument.js). It must:
//   - sentence-case prose + standalone "i"
//   - capitalize markdown headings
//   - NOT touch code (fenced or inline)
//   - NOT touch URLs / hashtags / @mentions (inherited from capitalizeSentences)
//
// Run: node scripts/test-capitalize-longform.cjs   (exit 0 = all pass)

const path = require('path');
const HELPERS = require(path.join(__dirname, '..', 'api', 'companyHeartbeat', 'helpers.js'));
const cap = HELPERS.capitalizeSentencesLongform;

let pass = 0, fail = 0;
function check(name, fn) {
  let ok = false, detail = '';
  try { const r = fn(); ok = r === true; if (!ok) detail = String(r); }
  catch (e) { ok = false; detail = 'threw: ' + (e && e.message ? e.message : e); }
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}

console.log('\n== capitalizeSentencesLongform ==');

check('lowercase prose → sentence case + "i" → "I"', () =>
  cap("hey everyone. today i want to talk. no spin.") === "Hey everyone. Today I want to talk. No spin.");

check('markdown heading first word capitalized', () =>
  cap("## why open source\n\nbecause it helps.") === "## Why open source\n\nBecause it helps.");

check('list items capitalized', () =>
  cap("- first thing\n- second thing") === "- First thing\n- Second thing");

check('fenced code block left untouched (incl. lowercase "i" and keywords)', () => {
  const out = cap("run this:\n\n```\nconst x = i;\nlet i = 0;\n```\n\ndone.");
  return out === "Run this:\n\n```\nconst x = i;\nlet i = 0;\n```\n\nDone.";
});

check('inline code left untouched, surrounding prose capitalized', () =>
  cap("the var `i` holds it.") === "The var `i` holds it.");

check('URL frozen — sentence starts capitalized, slug casing preserved', () =>
  cap("visit https://ambientpixels.ai/blog/index for more.") === "Visit https://ambientpixels.ai/blog/index for more.");

check('already-correct text is unchanged', () =>
  cap("This is fine. I agree.") === "This is fine. I agree.");

check('non-string returns as-is', () =>
  cap(null) === null && cap(undefined) === undefined && cap(42) === 42);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail === 0 ? 0 : 1);
