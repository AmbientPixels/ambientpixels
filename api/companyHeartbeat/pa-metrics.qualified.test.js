// Run: node companyHeartbeat/pa-metrics.qualified.test.js
'use strict';
const assert = require('assert');
const { countQualifiedUsesInEvents, countQualifiedPaUses7d, QUALIFIED_USE_EVENTS } = require('./pa-metrics');

const ev = (product, event, props, internal) => ({ product, event, props: props || {}, internal: internal === true, ts: '2026-10-05T12:00:00Z' });

// 1. One use per product's first-value event; page views and intermediate steps never count.
{
  const r = countQualifiedUsesInEvents([
    ev('pixelagents', 'page_view'), ev('pixelagents', 'agent_run_started', { runId: 'r1' }), ev('pixelagents', 'run_delivered', { runId: 'r1' }), ev('pixelagents', 'agent_run_completed', { runId: 'r1' }),
    ev('resumeroast', 'run_delivered', { runId: 'r2' }),
    ev('cardforge', 'quickbuild_completed'), ev('cardforge', 'page_view'),
    ev('storyforge', 'adventure_started'),
    ev('blindspot', 'card_created'), ev('blindspot', 'battle_end'),
    ev('agentforge', 'agent_submitted'),
    ev('ambientscore', 'scan_completed'),         // counted by cc_analytics, never here
    ev('blog', 'post_viewed')
  ]);
  assert.strictEqual(r.total, 6);
  assert.deepStrictEqual(r.byProduct, { pixelagents: 1, resumeroast: 1, cardforge: 1, storyforge: 1, blindspot: 1, agentforge: 1 });
  assert.strictEqual(QUALIFIED_USE_EVENTS.ambientscore, undefined, 'AmbientScore scans are not double counted');
}

// 2. A delivered run reported by both client and server is ONE use; internal sessions never count; unkeyed runs still count.
{
  const r = countQualifiedUsesInEvents([
    ev('pixelagents', 'run_delivered', { runId: 'same' }), ev('pixelagents', 'agent_run_completed', { runId: 'same' }),
    ev('pixelagents', 'agent_run_completed', {}),
    ev('cardforge', 'quickbuild_completed', {}, true),
    ev('pixelagents', 'run_delivered', { runId: 'x' }, true)
  ]);
  assert.strictEqual(r.total, 2);
  assert.deepStrictEqual(r.byProduct, { pixelagents: 2 });
}

// 3. Reader failure is unmeasured (null), never zero; window filter applies.
(async () => {
  const bad = await countQualifiedPaUses7d(Date.now(), async () => { throw new Error('blob down'); });
  assert.strictEqual(bad, null);
  const NOW = Date.parse('2026-10-06T12:00:00Z');
  const good = await countQualifiedPaUses7d(NOW, async () => [
    Object.assign(ev('cardforge', 'quickbuild_completed'), { ts: '2026-10-05T00:00:00Z' }),
    Object.assign(ev('cardforge', 'quickbuild_completed'), { ts: '2026-09-01T00:00:00Z' })   // outside 7d
  ]);
  assert.deepStrictEqual(good, { total: 1, byProduct: { cardforge: 1 } });
  assert.deepStrictEqual(countQualifiedUsesInEvents(null), { total: 0, byProduct: {} });
  console.log('pa-metrics.qualified.test.js: all assertions passed');
})().catch(e => { console.error(e); process.exit(1); });
