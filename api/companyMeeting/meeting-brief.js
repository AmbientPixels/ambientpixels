'use strict';

// Pure assembly of the meeting's shared business brief + per-agent memory slices
// + cross-meeting dedup. No state I/O — the caller loads state and passes it in.

const SHARED_BRIEF_CAP = 2500;

function _money(n) { return '$' + (Number(n) || 0).toFixed(2); }

// Render the money-forward brief from a worldState object (heartbeat buildWorldState
// output) + the outcomeDigest funnel. Every section is omitted if its source is
// missing — never throws (except the dev char-cap guard).
function buildSharedBrief(worldState, outcomeDigest) {
  const ws = worldState || {};
  const fin = ws.finance || {};
  const lines = [];
  lines.push('═══ BUSINESS BRIEF (money first) ═══');

  // MONEY
  const runway = (ws.company && ws.company.runwayDays != null) ? ws.company.runwayDays + 'd' : '—';
  lines.push('MONEY: revenue ' + _money(fin.monthlyRevenue) + ' MTD / ' + _money(fin.mrr) + ' MRR / ' +
    (fin.payingCustomers || 0) + ' paying. Spend ' + _money(fin.monthlyActual) + ' of ' + _money(fin.monthlyBudget) +
    ' (' + (fin.status || 'unknown') + '). Net burn ' + _money(fin.netBurn) + '. Runway ' + runway + '.');

  // PRODUCTS — earns vs burns
  const prods = Array.isArray(ws.products) ? ws.products : [];
  if (prods.length) {
    const pStr = prods.slice(0, 8).map(function (p) {
      const flag = (p.signal && /declin/i.test(p.signal)) ? ' BURNING' : '';
      return p.name + ' (' + (p.status || 'active') + (p.signal ? ', ' + p.signal : '') + flag + ')';
    }).join(', ');
    lines.push('PRODUCTS: ' + pStr + '.');
  }

  // FUNNEL
  const ot = (outcomeDigest && outcomeDigest.totals) || null;
  if (ot) {
    lines.push('FUNNEL: ' + (ot.complete || 0) + '/' + (ot.snapshots || 0) + ' posts measured → ' +
      (ot.blogViews || 0) + ' blog views → ' + (ot.formSubmits || 0) + ' form submits.');
  }

  // PIPELINE
  const objs = Array.isArray(ws.objectives) ? ws.objectives : [];
  if (objs.length) {
    lines.push('OBJECTIVES: ' + objs.slice(0, 5).map(function (o) { return '"' + o.title + '" ' + (o.progress || 0) + '%'; }).join(', ') + '.');
  }
  const camps = Array.isArray(ws.campaigns) ? ws.campaigns : [];
  if (camps.length) {
    lines.push('CAMPAIGNS: ' + camps.slice(0, 5).map(function (c) { return '"' + c.title + '" ' + (c.pace || '') + ' ' + (c.progress || 0) + '%'; }).join(', ') + '.');
  }

  lines.push('═══ END BRIEF ═══');
  const block = lines.join('\n');
  if (block.length > SHARED_BRIEF_CAP) {
    throw new Error('[meeting-brief] shared brief exceeds ' + SHARED_BRIEF_CAP + ' char cap: ' + block.length);
  }
  return block;
}

module.exports = { buildSharedBrief, SHARED_BRIEF_CAP };
