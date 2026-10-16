// today.js — HQ Today: renders GET /api/hq-summary with the HQ kit. Nothing else.
// No AgentEngine, no CompanyStore, no company-state reads, no writes: looking never changes anything.
// Every number comes from the server (api/_shared/metrics.js); a missing number says "not measured", never 0.
// Refreshes on load and every 2 minutes while the tab is visible. If a refresh fails, the last good
// answer stays on screen and the header says so.
(function () {
  'use strict';

  var REFRESH_MS = 2 * 60 * 1000;
  var BASE = '/modules/company/';
  // Interim homes until Inbox / Plan / Team ship (plan phases 2 and 5).
  var LINKS = { inbox: BASE + 'actions.html', tasks: BASE + 'tasks.html', plan: BASE + 'campaigns.html', team: BASE + 'fleet.html' };

  // Same rule as CompanyStore.resolveServerBase: only local dev proxies /api; everywhere else a POST or a
  // secret-bearing GET must go to the Function App directly.
  function apiBase() {
    var h = String(location.hostname || '').toLowerCase();
    return (h === 'localhost' || h === '127.0.0.1') ? '/api' : 'https://ambientpixels-nova-api.azurewebsites.net/api';
  }

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function utcTime(iso) { return iso ? String(iso).slice(11, 16) + ' UTC' : '—'; }
  function ago(iso) {
    var ms = Date.now() - Date.parse(iso || '');
    if (!isFinite(ms)) return '';
    var m = Math.round(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 48) return h + ' h ago';
    return Math.round(h / 24) + ' days ago';
  }
  function shortDate(ymd) {
    var d = new Date((ymd || '') + (String(ymd).length === 10 ? 'T12:00:00Z' : ''));
    return isFinite(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ymd;
  }
  function money(n) { return n === null || n === undefined ? null : '$' + Number(n).toFixed(2); }
  function empty(text, kind) { return '<li><p class="hq-empty' + (kind ? ' hq-empty--' + kind : '') + '">' + esc(text) + '</p></li>'; }
  function notMeasured(block) { return block && block.state === 'not_measured'; }
  function row(o) {
    var tag = o.href ? 'a' : 'div';
    return '<li><' + tag + ' class="hq-row' + (o.wrap ? ' hq-row--wrap' : '') + '"' + (o.href ? ' href="' + esc(o.href) + '"' : '') + '>' +
      '<span class="hq-row-main"><span class="hq-row-title">' + esc(o.title) + '</span>' +
      (o.meta ? '<span class="hq-row-meta">' + esc(o.meta) + '</span>' : '') + '</span>' +
      ((o.chip || o.end) ? '<span class="hq-row-end">' + (o.chip || '') + (o.end ? esc(o.end) : '') + '</span>' : '') +
      '</' + tag + '></li>';
  }
  function chip(state, label) { return '<span class="ap-state ap-state--' + state + '">' + esc(label) + '</span>'; }

  // ── Blocks ──
  function renderHealth(h) {
    var el = $('today-health');
    var state = (h && h.state) || 'attention';
    el.className = 'hq-health hq-health--' + (state === 'ok' ? 'ok' : state === 'broken' ? 'broken' : 'attention');
    var rest = (h && h.issues ? h.issues.slice(1) : []).map(function (i) { return '<li>' + esc(i.text) + '</li>'; });
    if (h && h.more) rest.push('<li>and ' + h.more + ' more</li>');
    el.innerHTML = '<span>' + esc((h && h.text) || "Couldn't check the fleet") + '</span>' +
      (rest.length ? '<ul class="hq-health-more">' + rest.join('') + '</ul>' : '');
  }

  var TYPE_LABEL = { video_request: 'Video request', ceo_task: 'Your task', campaign_proposal: 'Campaign proposal', objective_proposal: 'Goal proposal', publish_document: 'Publish', approval: 'Approval' };
  function renderWaiting(w) {
    var list = $('t-waiting');
    if (notMeasured(w)) { $('t-waiting-count').textContent = ''; list.innerHTML = empty("Couldn't read the approval queue — the count is not measured.", 'error'); return; }
    $('t-waiting-count').textContent = String(w.count);
    if (!w.count) { list.innerHTML = empty('Nothing waiting on you. The fleet runs at 00, 06, 12 and 18 UTC.'); return; }
    list.innerHTML = w.items.map(function (p) {
      return row({
        title: p.title,
        meta: (TYPE_LABEL[p.type] || String(p.type || '').replace(/_/g, ' ')) + (p.from ? ' · from ' + p.from : ''),
        end: ago(p.since),
        href: p.kind === 'task' ? LINKS.tasks : LINKS.inbox
      });
    }).join('');
    $('t-waiting-foot').textContent = w.count > w.items.length ? 'See all (' + w.count + ') →' : 'Open inbox →';
  }

  function renderGoal(g) {
    var el = $('t-goal');
    var head = '<h2 class="ap-kpi-label" id="t-goal-h">The goal</h2>';
    if (notMeasured(g)) { el.innerHTML = head + '<p class="hq-empty hq-empty--error">Couldn\'t read the goal — not measured.</p>'; return; }
    if (!g || g.state === 'none') { el.innerHTML = head + '<p class="hq-empty">No active goal. Set one in Plan.</p>'; return; }
    var measured = g.value !== null && g.value !== undefined;
    var pct = measured && g.target ? Math.max(0, Math.min(100, Math.round((g.value / g.target) * 20) * 5)) : 0;
    el.innerHTML = head +
      '<p class="ap-kpi-sub">' + esc(g.label) + '</p>' +
      (measured
        ? '<p class="ap-kpi-value">' + esc(g.value) + (g.target ? '<span class="ap-kpi-unit"> of ' + esc(g.target) + '</span>' : '') + '</p>' +
          (g.target ? '<div class="hq-meter" role="img" aria-label="' + esc(g.value + ' of ' + g.target) + '"><span class="hq-meter-fill hq-p' + pct + '"></span></div>' : '')
        : '<p class="ap-kpi-value ap-kpi-value--none">Not measured</p>') +
      '<p class="ap-kpi-sub">' + esc([g.target ? 'Target ' + g.target + ' a week' + (g.by ? ' by ' + shortDate(g.by) : '') : null,
        g.baseline !== null && g.baseline !== undefined ? 'started at ' + g.baseline : null,
        g.asOf ? 'measured ' + ago(g.asOf) : null].filter(Boolean).join(' · ')) + '</p>';
  }

  function renderWeek(w) {
    var pair = function (label, value, note) {
      var none = value === null || value === undefined;
      return '<dt>' + esc(label) + (note ? ' <span class="hq-small">' + esc(note) + '</span>' : '') + '</dt>' +
        '<dd' + (none ? ' class="is-none"' : '') + '>' + esc(none ? 'not measured' : value) + '</dd>';
    };
    $('t-week').innerHTML =
      pair('Posts published', w.published) +
      pair('Tasks done', w.tasksDone) +
      pair('AI spend', money(w.spend)) +
      pair('AI spend this month', money(w.spendMonth));
  }

  var PACE = { on_pace: ['good', 'On pace'], starting: ['info', 'Starting'], behind: ['warn', 'Behind'], not_measured: ['neutral', 'Not measured'] };
  function renderCampaigns(c) {
    var list = $('t-campaigns');
    if (notMeasured(c)) { list.innerHTML = empty("Couldn't read campaigns — pace is not measured.", 'error'); return; }
    if (!c.items.length) { list.innerHTML = empty('No active campaigns. New work starts when you approve one.'); return; }
    list.innerHTML = c.items.slice(0, 7).map(function (x) {
      var p = PACE[x.status] || PACE.not_measured;
      return row({
        title: x.title,
        meta: x.open + ' open task' + (x.open === 1 ? '' : 's') + (x.planned ? ' · ' + x.done + ' of ' + x.planned + ' ' + x.period : ''),
        chip: chip(p[0], p[1]),
        href: LINKS.plan
      });
    }).join('');
  }

  function renderFleet(f) {
    var list = $('t-fleet');
    if (!f.busy.length) list.innerHTML = empty('Nobody has queued work. Agents pick up new tasks at the next run.');
    else list.innerHTML = f.busy.slice(0, 7).map(function (a) {
      var meta = a.donePerDay > 0
        ? '~' + a.donePerDay + ' a day' + (a.clearBy ? ' · clear by ' + shortDate(a.clearBy) : '')
        : 'nothing finished this week';
      return row({ title: a.name, meta: meta, end: a.queue + ' queued', href: LINKS.team });
    }).join('');
    var rest = [];
    if (f.onCall.length) rest.push('On call: ' + f.onCall.join(', '));
    if (f.dormant.length) rest.push('Dormant: ' + f.dormant.join(', '));
    if (!f.registryRead) rest.push("Couldn't read the agent registry");
    $('t-fleet-rest').textContent = rest.join(' · ');
  }

  function renderHappened(h) {
    var list = $('t-happened');
    if (notMeasured(h)) { list.innerHTML = empty("Couldn't read the activity log.", 'error'); return; }
    if (!h.items.length) { list.innerHTML = empty('A quiet day: nothing finished, published or decided in the last 24 hours.'); return; }
    list.innerHTML = h.items.map(function (e) {
      return row({ title: e.text, end: ago(e.at), wrap: true, chip: e.tone === 'attention' ? chip('warn', 'Look') : '' });
    }).join('');
  }

  // ── Load ──
  var lastGood = null;
  function setAsOf(text) { $('today-asof').textContent = text; }

  function render(s) {
    var b = s.blocks;
    renderHealth(b.health);
    renderWaiting(b.waiting);
    renderGoal(b.goal);
    renderWeek(b.week);
    renderCampaigns(b.campaigns);
    renderFleet(b.fleet);
    renderHappened(b.happened);
    setAsOf('as of ' + utcTime(s.asOf) + ' · next fleet run ' + utcTime(s.nextRunAt));
    $('today').setAttribute('aria-busy', 'false');
  }

  function failed(message) {
    if (lastGood) {
      setAsOf("Couldn't refresh (" + message + ') — showing ' + utcTime(lastGood.asOf));
      return;
    }
    $('today').setAttribute('aria-busy', 'false');
    setAsOf('Not loaded');
    var el = $('today-health');
    el.className = 'hq-health hq-health--attention';
    el.textContent = "Couldn't load Today: " + message + '. Nothing is shown rather than a wrong number.';
    ['t-waiting', 't-campaigns', 't-fleet', 't-happened'].forEach(function (id) { $(id).innerHTML = empty('Not loaded.', 'loading'); });
    $('t-goal').innerHTML = '<h2 class="ap-kpi-label">The goal</h2><p class="ap-kpi-value ap-kpi-value--none">Not loaded</p>';
    $('t-week').innerHTML = '<dt>Not loaded</dt><dd></dd>';
  }

  function track(props) {
    try { if (window.AppInsightsService && window.AppInsightsService.trackEvent) window.AppInsightsService.trackEvent('hq_today_view', props); } catch (e) { /* telemetry never blocks */ }
  }

  function load() {
    var t0 = Date.now();
    var secret = window.AP_SECRET || '';
    if (!secret) { failed('this page has no access key — sign in again'); track({ ok: false, reason: 'no-secret' }); return; }
    fetch(apiBase() + '/hq-summary', { headers: { 'x-company-secret': secret } })
      .then(function (res) {
        if (res.status === 403) throw new Error('access refused (403) — sign in again');
        if (res.status === 503) throw new Error("the task board couldn't be read");
        if (!res.ok) throw new Error('the server answered ' + res.status);
        return res.json();
      })
      .then(function (s) {
        lastGood = s;
        render(s);
        track({ ok: true, ms: Date.now() - t0, health: s.blocks.health.state });
      })
      .catch(function (err) {
        failed(err && err.message ? err.message : 'no connection');
        track({ ok: false, ms: Date.now() - t0, reason: String(err && err.message || err) });
      });
  }

  load();
  setInterval(function () { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && lastGood && Date.now() - Date.parse(lastGood.asOf) > REFRESH_MS) load();
  });
})();
