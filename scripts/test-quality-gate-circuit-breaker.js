// Standalone verification for QG circuit breaker helpers.
// Does NOT talk to Azure — just exercises pure functions with mock data.
// Run: node scripts/test-quality-gate-circuit-breaker.js
const path = require('path');
const mod = require(path.join(__dirname, '..', 'api', 'companyHeartbeat', 'agent-runner.js'));

const { _countQgFailures, _isHallucinationFailure, _detectProductFromTask, _buildStrongFeedbackBlock, QG_FAIL_CIRCUIT_BREAKER_THRESHOLD } = mod;

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; } else { console.log('PASS:', msg); }
}

// _countQgFailures
assert(_countQgFailures(null) === 0, 'null task → 0');
assert(_countQgFailures({}) === 0, 'empty task → 0');
assert(_countQgFailures({ comments: [] }) === 0, 'empty comments → 0');
assert(_countQgFailures({ comments: [{ id: 'cmt-other-1' }] }) === 0, 'non-qg comment → 0');
assert(_countQgFailures({ comments: [
  { id: 'cmt-qgfail-111' }, { id: 'cmt-other' }, { id: 'cmt-qgfail-222' }
]}) === 2, 'two qg-fail comments → 2');

// _isHallucinationFailure
assert(_isHallucinationFailure(null) === false, 'null qg → false');
assert(_isHallucinationFailure({ issues: [] }) === false, 'empty issues → false');
assert(_isHallucinationFailure({ issues: ['buzzword detected'] }) === false, 'tone-only issue → false');
assert(_isHallucinationFailure({ issues: ['hallucinated feature: image upscaling'] }) === true, 'hallucinated keyword → true');
assert(_isHallucinationFailure({ issues: ['Pixel Agents does not have pricing tiers described'] }) === true, 'does not have → true');
assert(_isHallucinationFailure({ issues: ['invented stat: 95% accuracy'] }) === true, 'invented → true');
assert(_isHallucinationFailure({ issues: ['fabricated user count'] }) === true, 'fabricated → true');

// Regression guards for regex false positives/negatives
assert(_isHallucinationFailure({ issues: ['tone feels inventive but weak'] }) === false, 'inventive (adjective) → false, not hallucination');
assert(_isHallucinationFailure({ issues: ['reinvents the wheel'] }) === false, 'reinvents → false, not hallucination');
assert(_isHallucinationFailure({ issues: ['does not really include pricing'] }) === true, 'does not + adverb + include → true');
assert(_isHallucinationFailure({ issues: ['does not actually support that feature'] }) === true, 'does not + adverb + support → true');
assert(_isHallucinationFailure({ issues: ['inventing new features'] }) === true, 'inventing (verb) → true, hallucination');

// _detectProductFromTask
assert(_detectProductFromTask({ title: 'Draft LinkedIn post for Pixel Agents launch' }) === 'PixelAgents', 'pixel agents detected');
assert(_detectProductFromTask({ title: 'Draft post about Blindspot' }) === 'Blindspot', 'blindspot detected');
assert(_detectProductFromTask({ title: 'Generic post' }) === null, 'no product → null');
// Longest-match: when task mentions both AmbientOS and AmbientScore, the longer (more specific) name wins
assert(_detectProductFromTask({ title: 'Compare AmbientOS and AmbientScore' }) === 'AmbientScore', 'longest-match wins on cross-product tasks');

// _buildStrongFeedbackBlock
const block = _buildStrongFeedbackBlock('PixelAgents');
assert(block.indexOf('FOUNDER VOICE RULES') !== -1, 'block has voice rules header');
assert(block.indexOf('GOOD EXAMPLES') !== -1, 'block has examples header');
assert(block.indexOf('PRODUCT FACTS for PixelAgents') !== -1, 'block has product facts');
// Token budget: loop over EVERY product so a future product addition cannot silently blow the budget
const productFacts = require(path.join(__dirname, '..', 'api', '_data', 'product-facts.json'));
Object.keys(productFacts.products).forEach(function (pk) {
  const b = _buildStrongFeedbackBlock(pk);
  assert(b.length < 5000, 'block for ' + pk + ' fits token budget (<5000 chars, actual: ' + b.length + ')');
});

// Constants
assert(QG_FAIL_CIRCUIT_BREAKER_THRESHOLD === 3, 'threshold is 3');

console.log('\n' + (failures === 0 ? 'All passed.' : failures + ' failure(s).'));
process.exit(failures === 0 ? 0 : 1);
