// task-visibility.js — which tasks an agent can actually act on.
//
// Measured 2026-08-08: 51 policy violations in 24h, 30 of them ONE task
// (task-1785722401043-tjg0) blocked 31 times on camp-msckchvl-u5ck, a campaign
// paused on 08-05.
//
// The cause is an asymmetry, not a bad gate. index.js filters the campaign list
// to active only, so agents never SEE a paused campaign. The task board has no
// such filter, so they see its TASKS — and prompt-builders looks the campaign up
// in activeDirectives, fails, and silently skips the entire context block (no
// else branch). The agent gets an ordinary-looking task in 'review' with no hint
// that every mutation against it will be rejected. It tries, gets blocked, and
// does the same thing next cycle with a different agent.
//
// Filtering paused campaigns out of the prompt is precisely what makes the
// orphan look healthy: the "paused" signal was removed along with the campaign.
//
// The rule, same as the idle-agent gate: an agent should not pay to deliberate
// about work it is forbidden to do.
//
// Pure. No I/O.

'use strict';

/**
 * Split tasks into what an agent may act on and what is frozen behind a
 * non-active campaign.
 *
 * FAILS OPEN. If the active-campaign list is missing, empty or malformed, this
 * hides nothing. A Set-based filter fed an empty list would blank the entire
 * board and take the whole fleet silent — far worse than the loop it fixes.
 * Absence of data must never read as "everything is forbidden".
 *
 * @param {Array} tasks
 * @param {Array} activeCampaigns  campaigns already filtered to status==='active'
 * @returns {{visible:Array, hidden:Array}}
 */
function filterActionableTasks(tasks, activeCampaigns) {
  if (!Array.isArray(tasks)) return { visible: [], hidden: [] };
  if (!Array.isArray(activeCampaigns) || activeCampaigns.length === 0) {
    return { visible: tasks, hidden: [] };
  }

  const activeIds = new Set();
  activeCampaigns.forEach(function (c) { if (c && c.id) activeIds.add(c.id); });
  if (activeIds.size === 0) return { visible: tasks, hidden: [] };

  const visible = [];
  const hidden = [];
  tasks.forEach(function (t) {
    // No campaign, or a campaign that is still active → actionable.
    // A malformed entry is passed through untouched: this filter exists to hide
    // frozen work, not to quietly drop anything it cannot parse.
    if (!t || !t.campaign_id || activeIds.has(t.campaign_id)) visible.push(t);
    else hidden.push(t);
  });
  return { visible: visible, hidden: hidden };
}

/**
 * One-line description of what was hidden, for the cycle log. A filter that
 * removes work without saying so is indistinguishable from an empty queue —
 * which is how the dead Bluesky sensor went unnoticed for five weeks.
 */
function summarise(hidden) {
  if (!Array.isArray(hidden) || hidden.length === 0) return '';
  const byCampaign = {};
  hidden.forEach(function (t) {
    const c = (t && t.campaign_id) || 'unknown';
    byCampaign[c] = (byCampaign[c] || 0) + 1;
  });
  const parts = Object.keys(byCampaign).map(function (c) { return c + ' x' + byCampaign[c]; });
  return hidden.length + ' task(s) hidden behind non-active campaigns: ' + parts.join(', ');
}

module.exports = { filterActionableTasks, summarise };
