// Seed the companyStrategy state key (SE-1). Dry-run by default; --apply to write.
// CEO-confirmed 2026-06-11: revenue-first era, 4 north stars, monthly cadence.
const BASE = 'https://ambientpixels-nova-api.azurewebsites.net/api/company-state';
const SECRET = 'pixelpusher';
const APPLY = process.argv.includes('--apply');

const companyStrategy = {
  mission: 'AI-native studio where agents run the company and products ship in public.',
  era: 'real-company-v1',
  eraGoal: 'Prove the system can win real paying customers.',
  planningCadence: 'monthly',
  northStar: [
    { metric: 'paying_customers', label: 'Paying customers', priority: 1, target: 1, by: '2026-08-31', source: 'revenueDigest', current: 0, baseline: 0 },
    { metric: 'bluesky_followers', label: 'Bluesky followers', priority: 2, target: 500, by: '2026-09-30', source: 'socialAccountStats', baseline: 72 },
    { metric: 'blog_views_week', label: 'Blog views/week', priority: 3, target: 100, by: '2026-09-30', source: 'blogPostViews', baseline: 16 },
    { metric: 'weekly_active_users', label: 'Weekly active product users', priority: 4, target: 25, by: '2026-09-30', source: 'manual', current: null, baseline: 0 }
  ],
  riskPosture: 'autonomous-inside-rails',
  monthlyBudget: 35,
  updatedAt: new Date().toISOString(),
  updatedBy: 'CEO (session 2026-06-11)'
};

(async () => {
  const cur = await fetch(BASE + '?key=companyStrategy', { headers: { 'x-company-secret': SECRET } });
  if (cur.status === 400) { console.error('companyStrategy not in VALID_KEYS yet — deploy first.'); process.exit(1); }
  const existing = (await cur.json()).value;
  console.log('EXISTING:', JSON.stringify(existing, null, 2));
  console.log('\nPROPOSED:', JSON.stringify(companyStrategy, null, 2));
  if (existing && !APPLY) console.log('\nWARNING: key already has a value — --apply will OVERWRITE it (full JSON above is your rollback).');
  if (!APPLY) { console.log('\nDRY RUN — rerun with --apply to write.'); return; }
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-company-secret': SECRET },
    body: JSON.stringify({ key: 'companyStrategy', value: companyStrategy })
  });
  console.log('\nWRITE:', r.status, await r.text());
})().catch(e => { console.error('FATAL', e); process.exit(1); });
