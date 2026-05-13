// Contract tests for new community APIs. Hits the deployed Function App.
// Patterned after blindspot/tests/api-contract.js.

const API_BASE = process.env.BS_API_BASE || 'https://ambientpixels-nova-api.azurewebsites.net';

async function fetchJson(path) {
  const res = await fetch(API_BASE + path);
  const body = await res.text();
  let json = null;
  try { json = JSON.parse(body); } catch (_) {}
  return { status: res.status, json, raw: body };
}

function assert(cond, msg) {
  if (!cond) { throw new Error('ASSERTION FAILED: ' + msg); }
}

async function testCardviewMissingId() {
  const r = await fetchJson('/api/blindspotcardview');
  assert(r.status === 400, 'cardview without id should return 400, got ' + r.status);
  assert(r.json && r.json.error, 'should return { error }');
  console.log('  ✓ cardview without id returns 400');
}

async function testCardviewNotFound() {
  const r = await fetchJson('/api/blindspotcardview?id=does-not-exist-12345');
  assert(r.status === 404, 'unknown card id should return 404');
  console.log('  ✓ cardview with unknown id returns 404');
}

async function testCardviewShape() {
  // Pull a real cardId from published-cards.json directly (anon read enabled).
  const r0 = await fetch('https://cardforgeblobdata.blob.core.windows.net/cardforge/published-cards.json');
  if (!r0.ok) {
    console.log('  ⚠ could not fetch published-cards.json — skipping shape test');
    return;
  }
  const pubs = await r0.json();
  const arr = pubs.publishedCards || pubs.cards || (Array.isArray(pubs) ? pubs : []);
  if (!arr.length) {
    console.log('  ⚠ no published cards — skipping shape test');
    return;
  }
  const sampleId = arr[0].id;
  const r = await fetchJson('/api/blindspotcardview?id=' + encodeURIComponent(sampleId));
  assert(r.status === 200 || r.status === 404, 'cardview real id should return 200 or 404 (404 acceptable if owner is private)');
  if (r.status === 200) {
    assert(r.json && r.json.ok === true, 'response should have ok:true');
    assert(r.json.card && r.json.card.id === sampleId, 'card.id should match query');
    // Sanitization allowlist — no leak of unexpected fields.
    const allowed = new Set(['id','name','class','rarity','quote','avatar','combatStats','design','imageContainer','element','publishedBy','publishedByName','publishedAt','lastBattleAt','ogImageUrl','history']);
    for (const k of Object.keys(r.json.card)) {
      assert(allowed.has(k), 'unexpected leaked field: ' + k);
    }
    console.log('  ✓ cardview returns sanitized card shape for sample id ' + sampleId);
  } else {
    console.log('  ⚠ sample card returned 404 (owner may be private or not-found) — sanitizer not exercised');
  }
}

async function testRosterReachable() {
  const r = await fetchJson('/api/blindspotcommunityroster');
  assert(r.status === 200, 'roster GET should return 200, got ' + r.status);
  assert(r.json && r.json.ok === true, 'roster response should have ok:true');
  assert(Array.isArray(r.json.players), 'roster response should have players[] array');
  assert(typeof r.json.window === 'string', 'roster response should have window string');
  assert(typeof r.json.asOf === 'string', 'roster response should have asOf string');
  console.log('  ✓ roster endpoint reachable, basic shape ok');
}

async function run() {
  console.log('community-api-contract tests');
  await testCardviewMissingId();
  await testCardviewNotFound();
  await testCardviewShape();
  await testRosterReachable();
  console.log('all community-api-contract tests passed');
}

if (require.main === module) {
  run().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { run };
