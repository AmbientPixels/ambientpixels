// scout-mechanism-task.js — give Scout the one job nobody has: find the next mechanism.
//
// Pure. No I/O. Called from the heartbeat once the bet ledger exists.
//
// Why (2026-10-06): Scout was skipped in 100 of 100 heartbeats ("no assigned tasks or
// mentions"). Its only proposal trigger needs a research signal nobody produces. The
// ledger knows which mechanisms have never been tried; once a week this mints ONE task
// asking Scout for ONE bet on one of them, with evidence that has a denominator. The
// task is the lane; the bet gate and the ledger are the scoreboard. If Scout's bets
// never reach the sample floor, the ledger shows it and the agent goes dormant.
'use strict';

const TAG = 'mechanism-discovery';
const CADENCE_DAYS = 7;
const DUE_DAYS = 5;
const MAX_OPEN = 1;

const MECHANISM_HINTS = {
  search_page: 'queries people type (role-intent résumé searches, "landing page feedback", "ai card game maker", "interactive fiction ai"); source: Search Console impressions or a keyword tool with volume',
  directory_listing: 'Product Hunt, AI tool directories, top.gg, awesome-lists; source: the directory\'s own traffic or referrer counts for comparable tools',
  community_reply: 'threads where someone is already asking for what a free offer does (replies to named people go to the CEO); source: thread counts per week on the platform',
  weekly_scoreboard: 'one weekly numbers post replacing daily broadcast; source: our own per-post people counts',
  tool_or_utility: 'a free embed, badge, calculator or page that earns a link or a use; source: comparable tools\' referrers',
  partnership: 'another account or product sending people; source: their audience size',
  email: 'owned list; source: list size and last send',
  broadcast_post: 'original posts to our followers; source: our own per-post people counts (measured ~0 — cite it if you propose it)',
  copy_variant: 'an A/B inside an existing campaign; needs an active campaign with volume'
};

function _days(iso, nowMs) { const t = Date.parse(iso || ''); return Number.isFinite(t) ? (nowMs - t) / 86400000 : null; }
function _hasTag(t) { return t && Array.isArray(t.tags) && t.tags.indexOf(TAG) !== -1; }
function _isOpen(t) { const s = String((t && t.status) || '').toLowerCase(); return s !== 'done' && s !== 'canceled' && s !== 'cancelled' && s !== 'archived' && !(t && t._archived); }

// Returns { task, reason } — task is null when nothing should be minted.
function mintScoutMechanismTask(input) {
  const i = input || {};
  const now = Number.isFinite(i.nowMs) ? i.nowMs : Date.now();
  if (i.enabled === false) return { task: null, reason: 'disabled' };
  if (i.scoutActive === false) return { task: null, reason: 'scout_not_active' };
  const tasks = Array.isArray(i.tasks) ? i.tasks : [];
  const mine = tasks.filter(_hasTag);
  if (mine.filter(_isOpen).length >= MAX_OPEN) return { task: null, reason: 'open_task_exists' };
  const newest = mine.map(t => _days(t.createdAt, now)).filter(d => d !== null).sort((a, b) => a - b)[0];
  if (newest !== undefined && newest < CADENCE_DAYS) return { task: null, reason: 'minted_within_cadence' };

  const ledger = i.ledger || {};
  const never = Array.isArray(ledger.neverTried) ? ledger.neverTried : Object.keys(MECHANISM_HINTS);
  const pool = never.length ? never : Object.keys(MECHANISM_HINTS);
  // rotate by ISO week so consecutive tasks walk the list instead of repeating the first entry
  const week = Math.floor(now / (7 * 86400000));
  const mechanism = pool[week % pool.length];
  const hint = MECHANISM_HINTS[mechanism] || '';
  const rows = Array.isArray(ledger.rows) ? ledger.rows.slice(0, 5) : [];
  const ledgerLines = rows.length
    ? rows.map(r => '- ' + r.result.toUpperCase() + ' ' + r.betKey + ' (' + ((r.actual && r.actual.value) == null ? 'unmeasured' : r.actual.value + ' people vs expected ' + r.expected) + ')').join('\n')
    : '- none scored yet';

  const id = 'task_' + now + '_scoutmech_' + Math.random().toString(36).slice(2, 6);
  const task = {
    id,
    title: 'Mechanism discovery: propose ONE bet on "' + mechanism + '"',
    description:
      'Your job this week: find ONE way to put real people in front of a free offer through the mechanism "' + mechanism + '" (' + hint + ').\n\n' +
      'Deliver it as a propose-campaign action whose `bet` object passes the contract in the PROPOSE NEW WORK section: mechanism "' + mechanism + '", a named product and channel, a one-sentence hypothesis, evidence with a denominator (k of n, window, source, asOf), an expected effect on qualified_uses_week, and a kill rule on campaign_qualified_uses with byDay <= 14. ' +
      'Evidence must come from a source you can name (Search Console, a directory\'s traffic, a thread count you measured, a product-analytics funnel). A number without a denominator is not evidence.\n\n' +
      'Cover all eight products (PRODUCT FACTS), not only the two the north star counts today. If the honest answer is "this mechanism cannot reach anyone for us", say so in a task comment with the number that shows it, and do not propose.\n\n' +
      'What the ledger already knows (do not re-propose a LOST or KILLED betKey without newer evidence):\n' + ledgerLines + '\n\n' +
      'Mechanisms never tried: ' + (never.length ? never.join(', ') : 'none') + '.',
    status: 'todo',
    assignee: 'scout',
    priority: 'medium',
    objective_id: i.objectiveId || null,
    campaign_id: null,
    dueDate: new Date(now + DUE_DAYS * 86400000).toISOString(),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    tags: [TAG, 'system-minted', 'mechanism:' + mechanism],
    source: { type: 'scout_mechanism_task', mechanism: mechanism }
  };
  return { task, reason: 'minted', mechanism };
}

module.exports = { mintScoutMechanismTask, TAG, CADENCE_DAYS, DUE_DAYS, MECHANISM_HINTS };
