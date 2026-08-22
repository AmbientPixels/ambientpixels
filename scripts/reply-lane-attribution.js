#!/usr/bin/env node
// reply-lane-attribution.js — did the outbound reply lane send anybody who used the product?
//
//   node scripts/reply-lane-attribution.js [range] [product]
//   node scripts/reply-lane-attribution.js 14d
//   node scripts/reply-lane-attribution.js 30d resumeroast
//
// Reads COMPANY_WRITE_SECRET from the environment, or from
// c:/Dev/Ambientpixels/COMPANY_WRITE_SECRET.txt (outside the repo).
//
// WHY THIS EXISTS
// The company shipped 195 posts in four months and could report how many likes they
// drew, but not which of them sent a human who actually ran a product. "Is outbound
// worth doing" stayed an opinion. Every post already carries utm_content = the action
// id that produced it, and js/product-analytics.js replays that onto every later event
// for the visitor, so the join has been possible the whole time and simply unread.
//
// This resolves each attributed action id back to the post or reply that earned the
// visit, so the output names the actual sentence somebody responded to.
//
// READING IT
// - PEOPLE, never events. One visitor who starts three runs is one person who found
//   us. Counting events is how a KPI got inflated 22x here before.
// - "unattributed" is most of the funnel and that is normal: direct visits, organic
//   search, and shared links with the params stripped all land without UTM. Judge the
//   lane on what it adds, not on its share of a small total.
// - A source with people > 0 and completed = 0 sent real humans who bounced. That is a
//   landing-page or product problem, not a distribution one, and it is worth knowing
//   which of the two you have.

const fs = require('fs');

const BASE = 'https://ambientpixels-nova-api.azurewebsites.net/api';
const RANGE = process.argv[2] || '14d';
const PRODUCT = process.argv[3] || 'resumeroast';

function readSecret() {
  if (process.env.COMPANY_WRITE_SECRET) return process.env.COMPANY_WRITE_SECRET;
  try {
    const raw = fs.readFileSync('c:/Dev/Ambientpixels/COMPANY_WRITE_SECRET.txt', 'utf8');
    const m = raw.match(/COMPANY_WRITE_SECRET\s*=\s*(\S+)/);
    return m ? m[1] : raw.trim();
  } catch (e) { return ''; }
}

async function getJson(url, secret) {
  const res = await fetch(url, { headers: { 'x-company-secret': secret } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}

// A failed state read returns an error object whose .value is undefined, which reads
// as an empty array and quietly becomes a zero. Distinguish the two.
async function getState(key, secret) {
  const j = await getJson(BASE + '/company-state?key=' + encodeURIComponent(key), secret);
  if (j && j.error) throw new Error('state read failed for ' + key + ': ' + j.error);
  return j && j.value !== undefined ? j.value : j;
}

function label(action) {
  if (!action) return null;
  const p = action.payload || action.action_payload || {};
  const text = String(p.text || p.reply_text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  const kind = action.type === 'social_post.reply' ? 'reply' : 'post';
  return { kind, platform: action.platform || '?', agent: action.created_by || '?', when: String(action.created_at || '').slice(0, 10), text };
}

(async () => {
  const secret = readSecret();
  if (!secret) { console.error('No COMPANY_WRITE_SECRET found.'); process.exit(1); }

  const [srcRes, actions] = await Promise.all([
    getJson(BASE + '/productAnalyticsQuery?product=' + PRODUCT + '&range=' + RANGE + '&metric=sources', secret),
    getState('actions', secret)
  ]);
  const d = srcRes.data;
  const byId = {};
  (Array.isArray(actions) ? actions : []).forEach(a => { byId[a.id] = a; });

  console.log('Reply-lane attribution — product=' + PRODUCT + ' range=' + RANGE);
  console.log('(people, not events)\n');

  console.log('REACH');
  console.log('  people total          ' + String(d.totalPeople).padStart(5));
  console.log('  ...attributed to a post ' + String(d.attributedPeople).padStart(3));
  console.log('  ...no UTM (direct/organic/stripped) ' + String(d.unattributedPeople).padStart(3));

  if (!d.bySource.length) {
    console.log('\nNo attributed visitors in this window.');
    console.log('That is a real zero only if posts actually shipped in it — check');
    console.log('socialMetricsEvents before concluding the lane does not work.');
    return;
  }

  console.log('\nBY SOURCE');
  console.log('  ' + 'source'.padEnd(14) + 'people'.padStart(7) + 'started'.padStart(9) + 'completed'.padStart(11));
  d.bySource.forEach(r => {
    console.log('  ' + String(r.source).padEnd(14) + String(r.people).padStart(7) + String(r.started).padStart(9) + String(r.completed).padStart(11));
  });

  console.log('\nBY ORIGINATING POST');
  d.byAction.forEach(r => {
    const l = label(byId[r.actionId]);
    console.log('\n  ' + r.people + ' people · ' + r.started + ' started · ' + r.completed + ' completed   [' + r.source + ']');
    if (l) {
      console.log('    ' + l.kind + ' · ' + l.platform + ' · ' + l.agent + ' · ' + l.when);
      console.log('    "' + l.text.slice(0, 150) + (l.text.length > 150 ? '…' : '') + '"');
    } else {
      console.log('    ' + r.actionId + ' (action not in the live store — likely archived)');
    }
  });

  const completed = d.bySource.reduce((s, r) => s + r.completed, 0);
  const people = d.bySource.reduce((s, r) => s + r.people, 0);
  console.log('\nVERDICT');
  if (people === 0) console.log('  Distribution sent nobody. The lane is not working, or nothing shipped.');
  else if (completed === 0) console.log('  Distribution sent ' + people + ' real people and none finished a run.');
  else console.log('  Distribution sent ' + people + ' people and ' + completed + ' finished a run.');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
