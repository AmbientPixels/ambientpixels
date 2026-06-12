// SE-2 retrofit: completion flips for 3 of 4 active objectives (CEO-sanctioned,
// handoff 2026-06-11 §3: "3 are at 90-99% and need completion flips anyway").
// Dry-run by default; --apply to write. Prints full BEFORE JSON as rollback trail.
const BASE = 'https://ambientpixels-nova-api.azurewebsites.net/api/company-state';
const SECRET = 'pixelpusher';
const APPLY = process.argv.includes('--apply');
const HDRS = { 'x-company-secret': SECRET };

const FLIPS = {
  'obj-founder-voice': 'Superseded by north star bluesky_followers (72->500 by 2026-09-30); original 90-day criterion expired.',
  'obj-pulse-promo': '30-day promo window long expired at 99% task progress.',
  'obj-the-floor': 'Agents-as-brand is now the default operating mode; objective served its purpose at 90%.'
};

(async () => {
  const get = async (k) => (await (await fetch(BASE + '?key=' + k, { headers: HDRS })).json()).value || [];
  const objectives = await get('objectives');
  const govLog = await get('governanceLog');
  const now = new Date().toISOString();
  console.log('BEFORE:', JSON.stringify(objectives.filter(o => FLIPS[o.id]), null, 2));
  let changed = 0;
  for (const o of objectives) {
    if (!FLIPS[o.id] || o.status === 'complete') continue;
    o.status = 'complete';
    o.progress = 100;
    o.completedAt = now;
    o.completedBy = 'retrofit:se2';
    o.retrofitNote = FLIPS[o.id];
    govLog.push({
      id: 'gov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      type: 'objective_retrofit_complete',
      data: { objectiveId: o.id, title: o.title, note: FLIPS[o.id] },
      timestamp: now
    });
    changed++;
    console.log('FLIP -> complete:', o.id, '—', FLIPS[o.id]);
  }
  if (!changed) { console.log('Nothing to do (already complete?).'); return; }
  console.log('\nAFTER:', JSON.stringify(objectives.filter(o => FLIPS[o.id]), null, 2));
  if (!APPLY) { console.log('\nDRY RUN — rerun with --apply to write objectives + governanceLog.'); return; }
  for (const [key, value] of [['objectives', objectives], ['governanceLog', govLog]]) {
    const r = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-company-secret': SECRET },
      body: JSON.stringify({ key, value })
    });
    console.log('WRITE', key + ':', r.status);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
