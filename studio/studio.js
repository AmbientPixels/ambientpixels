/* AmbientPixels Studio: the front end for the AI video pipeline.
   Plan: ai-video-pipeline/docs/plans/2026-10-12-studio-harness-plan.md
   One UI, two backends: on this PC (localhost, served by harness/server.mjs) it talks to the local API, which
   reads the project folders directly; anywhere else it talks to the Function App, which serves what the PC's
   worker uploaded. The API base is an allowlist: only a local host gets the relative path.
   Decisions made here (timestamped notes, approvals, picks, answers) become events. Locally they are written
   straight into the project's feedback/ folder; on the site they wait in an inbox until the PC collects them. */
(function () {
  'use strict';

  var LOCAL = ['localhost', '127.0.0.1'].indexOf(location.hostname) !== -1;
  var API = LOCAL ? '/api/studio' : 'https://ambientpixels-nova-api.azurewebsites.net/api/studio';
  var KEY_NAME = 'ap_studio_key'; // the credential only; no data is ever cached in the browser

  var app = document.getElementById('app');
  var crumbs = document.getElementById('crumbs');
  var workerEl = document.getElementById('worker');
  var cleanup = []; // listeners a view adds to document; removed on the next route

  function getKey() { try { return localStorage.getItem(KEY_NAME) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { k ? localStorage.setItem(KEY_NAME, k) : localStorage.removeItem(KEY_NAME); } catch (e) {} }

  function NeedKey() {}

  function request(method, action, query, body, as) {
    var url = API + '/' + action + (query ? '?' + new URLSearchParams(query) : '');
    var headers = LOCAL ? {} : { 'x-studio-key': getKey() };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }).then(function (res) {
      if (res.status === 403) throw new NeedKey();
      if (!res.ok) return res.json().catch(function () { return {}; }).then(function (b) {
        var err = new Error(b.error || ('HTTP ' + res.status)); err.status = res.status; throw err;
      });
      return as === 'text' ? res.text() : res.json();
    });
  }
  function call(action, query, as) { return request('GET', action, query, null, as); }
  function post(event) { return request('POST', 'event', null, event).then(function (r) { return r.event; }); }

  // Every event for a project: the ones already written on the PC (feedback/events.json) plus any still
  // waiting in the site's inbox.
  function loadEvents(id) {
    var applied = call('text', { project: id, path: 'projects/' + id + '/feedback/events.json' }, 'text')
      .then(function (t) { return JSON.parse(t); }).catch(function () { return []; });
    var pending = call('events', { project: id }).then(function (r) {
      return r.events.map(function (e) { e.pending = true; return e; });
    }).catch(function () { return []; });
    return Promise.all([applied, pending]).then(function (both) {
      var seen = {}, out = [];
      both[0].concat(both[1]).forEach(function (e) { if (!seen[e.id]) { seen[e.id] = 1; out.push(e); } });
      return out;
    });
  }

  // ---- tiny DOM helpers (text only: nothing from a manifest is parsed as HTML except through md()) ----
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function button(cls, text, onClick) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; }
  function headline(text, punch) { var h = el('h1', 'ap-display st-h', text + ' '); add(h, el('em', null, punch)); return h; }
  function section(idx) { return add(el('section', 'st-sec'), el('div', 'ap-sec-idx', idx)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function when(iso) {
    if (!iso) return 'never';
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function mmss(t) { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + pad2(Math.floor(t % 60)); }
  function baseName(p) { return p.slice(p.lastIndexOf('/') + 1); }
  function row(href, n, title, meta, status, statusCls) {
    var a = el('a', 'st-row');
    a.href = href;
    var mid = add(el('div'), el('h3', null, title), el('span', 'meta', meta));
    return add(a, el('span', 'n', n), mid, el('span', 'ap-status ' + (statusCls || ''), status), el('span', 'go', '→'));
  }
  function setCrumbs(parts) {
    crumbs.textContent = '';
    parts.forEach(function (p, i) {
      if (i) crumbs.appendChild(document.createTextNode(' / '));
      if (p.href) { var a = el('a', null, p.text); a.href = p.href; crumbs.appendChild(a); }
      else crumbs.appendChild(document.createTextNode(p.text));
    });
  }
  // Views render into `target`: the whole page on Home, the workspace's main column inside a project.
  var target = app;
  function show(nodes) { target.textContent = ''; nodes.forEach(function (n) { target.appendChild(n); }); }
  // "What this is, what's next": the plain-language line at the top of every page.
  function guide(what, next) {
    var g = el('div', 'st-guide');
    add(g, el('p', null, what));
    if (next) add(g, add(el('p'), el('b', null, 'Next: '), document.createTextNode(next)));
    return g;
  }
  function flash(node, text) { node.textContent = text; }

  // ---- markdown, small and safe: everything is escaped first, then a few patterns are formatted ----
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,:;]|$)/g, '$1<em>$2</em>');
  }
  function md(text) {
    var lines = text.replace(/\r/g, '').split('\n'), out = [], i = 0;
    while (i < lines.length) {
      var l = lines[i];
      if (/^\s*\|/.test(l)) {
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
        var cells = function (r) { return r.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); };
        var body = rows.filter(function (r) { return !/^\s*\|[\s:|-]+\|\s*$/.test(r); });
        out.push('<table class="st-table"><thead><tr>' + cells(body[0]).map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          body.slice(1).map(function (r) { return '<tr>' + cells(r).map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>');
        continue;
      }
      if (/^```/.test(l)) {
        var code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        i++;
        out.push('<pre class="st-pre">' + esc(code.join('\n')) + '</pre>');
        continue;
      }
      var h = /^(#{1,4})\s+(.*)$/.exec(l);
      if (h) { out.push('<h' + (h[1].length + 1) + ' class="st-md-h">' + inline(h[2]) + '</h' + (h[1].length + 1) + '>'); i++; continue; }
      if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
        var items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        out.push('<ul class="st-md-list">' + items.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>');
        continue;
      }
      if (!l.trim()) { i++; continue; }
      var para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||```|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
      out.push('<p>' + inline(para.join(' ')) + '</p>');
    }
    var div = el('div', 'st-md');
    div.innerHTML = out.join('\n');
    return div;
  }

  function showWorker(w) {
    var online = w && w.at && (w.local || Date.now() - new Date(w.at).getTime() < 90 * 1000);
    workerEl.className = 'ap-status ' + (online ? '' : 'ap-status--archive');
    workerEl.textContent = !w ? 'PC never seen' : w.local ? 'Local mode · ' + w.host : online ? 'PC online · ' + (w.status || w.host) : 'PC offline · last seen ' + when(w.at);
  }

  // ---- views ----
  function viewKey(refused) {
    setCrumbs([{ text: 'Studio' }]);
    var frag = document.getElementById('tpl-key').content.cloneNode(true);
    show([frag]);
    if (refused) document.getElementById('key-error').hidden = false;
    document.getElementById('key-form').addEventListener('submit', function (e) {
      e.preventDefault();
      setKey(document.getElementById('key-input').value.trim());
      route();
    });
    return Promise.resolve();
  }

  function viewProjects() {
    setCrumbs([{ text: 'Studio' }]);
    return call('projects').then(function (r) {
      showWorker(r.worker);
      var s = section('§ 01 — PROJECTS');
      add(s, headline('Every video in production,', 'one studio.'),
        guide('A project holds a set of videos. Open one to see each video\'s stages (Script, Voice, Scenes, Review, Deliver) and what comes next. Press ? at the top right for a two-minute guide.',
          LOCAL ? 'Open a project below.' : 'This is the website view, for reviewing away from your desk. Making things happens in the local studio (OPEN-STUDIO.cmd on your PC).'));
      var rows = el('div', 'st-rows');
      r.projects.forEach(function (p, i) {
        var meta = p.videos + ' videos · ' + p.drafts + ' drafts · scanned ' + when(p.scannedAt);
        var hosted = p.hosted !== false;
        add(rows, row('#/p/' + encodeURIComponent(p.id), pad2(i + 1), p.name + '.', meta,
          LOCAL ? (hosted ? 'Hosted' : 'Local only') : 'Hosted', hosted ? 'st-status--cloud' : 'st-status--pc'));
      });
      if (!r.projects.length) add(rows, el('p', 'st-empty', 'No projects yet. The PC uploads them.'));
      // Creating happens on the PC. On the website the button stays visible, dimmed, with the reason.
      var newBar = el('div', 'st-toolbar st-newbar');
      var newBtn = el('a', 'ap-btn ap-btn--primary', 'New project →');
      if (LOCAL) newBtn.href = '#/new';
      else { newBtn.setAttribute('aria-disabled', 'true'); newBtn.className += ' st-dim'; }
      add(newBar, newBtn, LOCAL ? null : el('span', 'st-note', 'New projects are made in the local studio (OPEN-STUDIO.cmd).'));
      var nodes = [add(s, newBar, rows)];
      if (!LOCAL) {
        var foot = el('p', 'st-note st-foot');
        add(foot, button('st-link', 'Forget the studio key on this browser', function () { setKey(''); route(); }));
        nodes.push(foot);
      }
      show(nodes);
    });
  }

  // ---- the video team (local studio only: the team lives on the PC) ----
  var MODEL_LABEL = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };
  // The natural role for each page: Script → Writer, Scenes → Animator, and so on. Chad can switch.
  var ROLE_FOR = { script: 'writer', voice: 'sound-designer', scenes: 'animator', review: 'editor', deliver: 'finisher', captures: 'screen-editor', library: 'sound-designer' };
  var teamCache = null;
  function getTeam(fresh) {
    if (!LOCAL) return Promise.reject(new Error('The team is managed in the local studio (OPEN-STUDIO.cmd).'));
    if (!fresh && teamCache && Date.now() - teamCache.at < 10000) return teamCache.p;
    var p = call('team');
    teamCache = { p: p, at: Date.now() };
    p.catch(function () { teamCache = null; });
    return p;
  }
  var preferredRole = null; // set by "Talk to this role" on a role page, used by the next chat panel

  function viewTeam() {
    setCrumbs([{ text: 'Team' }]);
    target = app;
    if (!LOCAL) return Promise.resolve(show([add(section('§ — TEAM'), headline('Eight roles,', 'one team.'),
      guide('The team is managed in the local studio on your PC (OPEN-STUDIO.cmd): briefs, models, budgets and what each role may change.'))]));
    return getTeam(true).then(function (t) {
      var s = add(section('§ — TEAM'), headline('Eight roles,', 'one team.'),
        guide('Each role is a member of the video team with one job, its own brief, its own tools and its own part of a project it may change without asking. Open a role to set its brief, model, budget and permissions. In a project, the chat panel lets you talk to any role.',
          'Open a role to see and set its controls.'));
      var rows = el('div', 'st-rows');
      t.roles.forEach(function (r, i) {
        var meta = (MODEL_LABEL[r.model] || r.model) + ' · $' + r.budget + ' cap · ' + (r.freeEdit.length ? 'edits ' + r.freeEdit.join(', ') : 'asks before every edit');
        add(rows, row('#/team/' + r.id, pad2(i + 1), r.name + '.', r.mandate + '  ·  ' + meta, r.enabled ? 'On' : 'Off', r.enabled ? '' : 'ap-status--archive'));
      });
      show([add(s, rows)]);
    });
  }

  function viewRole(id) {
    target = app;
    if (!LOCAL) return viewTeam();
    return Promise.all([getTeam(true), call('team-activity', { role: id }), call('projects')]).then(function (all) {
      var t = all[0], acts = all[1].activity, projects = all[2].projects;
      var r = t.roles.filter(function (x) { return x.id === id; })[0];
      if (!r) throw new Error('No role ' + id);
      setCrumbs([{ text: 'Team', href: '#/team' }, { text: r.name }]);
      var s = add(section('§ — ' + r.name.toUpperCase()), headline(r.name + ',', r.enabled ? 'on the team.' : 'switched off.'),
        guide(r.mandate, 'Set how this role works below. Its brief is what its Claude reads before every chat.'));

      // Controls
      var form = el('form', 'st-wizard');
    form.noValidate = true; // the server checks and explains; the browser's check fails silently
      var enabled = choices('enabled', [['on', 'On', 'Can be chosen in chat'], ['off', 'Off', 'Hidden from the chat\'s "Talk to"']], r.enabled ? 'on' : 'off');
      var model = select(t.models.map(function (m) { return [m, MODEL_LABEL[m] || m]; }), r.model);
      var budget = input('number', String(r.budget));
      budget.step = 'any'; budget.min = '0.25'; budget.max = '20';
      var free = el('textarea', 'st-input st-chat-input');
      free.rows = 3;
      free.value = r.freeEdit.join('\n');
      var brief = el('textarea', 'st-input st-brief-edit');
      brief.rows = 22;
      brief.value = r.brief;
      var status = el('span', 'st-note');
      var save = el('button', 'ap-btn ap-btn--primary st-run', 'Save →');
      save.type = 'submit';
      add(form,
        add(el('fieldset', 'st-step'), el('legend', 'ap-sec-idx', '01 — ON THE TEAM'), enabled),
        add(el('fieldset', 'st-step'), el('legend', 'ap-sec-idx', '02 — MODEL AND BUDGET'),
          add(el('div', 'st-job-form'), field('Model', model), field('Default cap per chat ($)', budget))),
        add(el('fieldset', 'st-step'), el('legend', 'ap-sec-idx', '03 — MAY CHANGE WITHOUT ASKING'),
          el('p', 'st-note', 'Paths inside a project, one per line: a folder ends with / (series/), a file is its name (NOTES.md). Everything else, and every command, shows you an Approve card.'),
          free),
        add(el('fieldset', 'st-step'), el('legend', 'ap-sec-idx', '04 — BRIEF'),
          el('p', 'st-note', 'What this role is for, how it works and its quality bar. Saved to harness/team/' + r.id + '.md.'), brief),
        add(el('div', 'st-toolbar'), save, status));
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        save.disabled = true;
        request('POST', 'team-role', null, {
          id: r.id, enabled: picked(form, 'enabled') === 'on', model: model.value, budget: Number(budget.value),
          freeEdit: free.value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean), brief: brief.value
        }).then(function () { teamCache = null; flash(status, 'Saved. The next chat with this role uses it.'); })
          .catch(function (err) { flash(status, err.message); })
          .then(function () { save.disabled = false; });
      });
      s.appendChild(form);

      // Talk to this role in a project
      var talk = add(section('§ — TALK TO THE ' + r.name.toUpperCase()), guide('Open a project with this role picked in its chat panel.'));
      var tr = el('div', 'st-rows');
      projects.forEach(function (p, i) {
        var a = row('#/p/' + encodeURIComponent(p.id), pad2(i + 1), p.name + '.', p.videos + ' videos', 'Talk', '');
        a.addEventListener('click', function () { preferredRole = r.id; });
        tr.appendChild(a);
      });
      talk.appendChild(tr);

      // Tools and activity
      var tools = add(section('§ — TOOLS'), guide('The tools this role works with. Status checks (ready, missing, needs setup) arrive with the Tools deck.'));
      var tl = el('div', 'st-checklist');
      (r.tools.length ? r.tools : ['(none yet)']).forEach(function (x) { tl.appendChild(add(el('div', 'st-check'), el('span', 'st-rail-mark', '·'), el('span', null, x))); });
      tools.appendChild(tl);
      var act = section('§ — RECENT ACTIVITY');
      if (!acts.length) act.appendChild(el('p', 'st-empty', 'Nothing yet. Talk to this role in a project.'));
      var al = el('div', 'st-board');
      acts.forEach(function (a) {
        var what = a.event === 'chat-start' ? 'Chat started: ' + (a.title || '') : a.event === 'turn' ? 'Replied (' + a.subtype + ') · $' + Number(a.cost || 0).toFixed(2) + ' so far'
          : a.event === 'edit-auto' ? 'Edited ' + (a.file || '').replace(/^.*projects[\\/]/, '') : a.event === 'approved' ? 'Ran ' + a.tool + ' (you approved)' : a.event === 'denied' ? a.tool + ' denied by you' : a.event;
        al.appendChild(add(el('div', 'st-cue'), el('span', 'st-cue-t', when(a.at)), el('span', 'st-cue-x', a.project + ' · ' + what)));
      });
      act.appendChild(al);
      show([s, talk, tools, act]);
    });
  }

  // ---- new project (local only): three short steps, then the project exists ----
  function choices(name, options, value) {
    var wrap = el('div', 'st-choices');
    options.forEach(function (o) {
      var l = el('label', 'st-choice');
      var r = el('input');
      r.type = 'radio'; r.name = name; r.value = o[0];
      if (o[0] === value) r.checked = true;
      add(l, r, add(el('span'), el('b', null, o[1]), o[2] ? el('span', 'st-note', o[2]) : null));
      wrap.appendChild(l);
    });
    return wrap;
  }
  function picked(form, name) { var x = form.querySelector('input[name="' + name + '"]:checked'); return x ? x.value : ''; }

  function viewNewProject() {
    setCrumbs([{ text: 'Studio', href: '#/' }, { text: 'New project' }]);
    if (!LOCAL) return Promise.resolve(show([add(section('§ — NEW PROJECT'), el('p', 'st-empty', 'New projects are made in the local studio (OPEN-STUDIO.cmd on your PC).'))]));
    var s = add(section('§ — NEW PROJECT'), headline('A new project,', 'three questions.'),
      guide('This creates the project\'s folder on your PC: a decisions log (NOTES.md) holding your answers, a place for scripts, captures and review notes, and the scene kit\'s styles. Nothing else happens until you ask.',
        'Answer the three steps, then press Create.'));
    var form = el('form', 'st-wizard');
    form.noValidate = true; // the server checks and explains; the browser's check fails silently
    var name = input('text', '', 'e.g. AmbientScore walkthrough');
    var goal = input('text', '', 'e.g. Show a store owner how to read their score in 90 seconds');
    var audience = input('text', '', 'e.g. small online store owners');
    add(form,
      add(el('fieldset', 'st-step'), el('legend', 'ap-sec-idx', '01 — WHAT IS IT?'),
        field('Name', name),
        choices('kind', [['walkthrough', 'Product walkthrough', 'One product, shown working'], ['series', 'Tutorial series', 'Several short chapters'],
          ['promo', 'Promo or trailer', 'Short, music-led'], ['other', 'Other', 'Tell Claude in the chat']], 'walkthrough'),
        field('What the videos are for (one line)', goal), field('Who watches them', audience)),
      add(el('fieldset', 'st-step'), el('legend', 'ap-sec-idx', '02 — WHERE CAN IT LIVE?'),
        choices('where', [['local', 'Local only', 'Media never leaves this PC. The right choice for client work.'],
          ['hosted', 'Hosted too', 'Can be reviewed on ambientpixels.ai. Needs one extra setting on Azure; you\'ll get the command.']], 'local')),
      add(el('fieldset', 'st-step'), el('legend', 'ap-sec-idx', '03 — LOOK AND VOICE'),
        el('p', 'st-note', 'The look is recorded in NOTES.md for Claude to build the scenes in. Until then, a new video\'s starter slate uses the kit\'s default look.'),
        choices('style', [['ap-monolith', 'AmbientPixels Monolith', 'Black, Archivo, rules not cards'], ['kit', 'Kit default', 'The scene kit\'s neutral style'],
          ['client', 'A client\'s brand', 'Give Claude the colours, fonts and logo']], 'ap-monolith'),
        choices('narration', [['human', 'Human voiceover', 'Record it, then drop it in'], ['ai', 'AI voice', 'Audition voices first; nothing is generated until you approve one']], 'ai')));
    var status = el('span', 'st-note');
    var go = el('button', 'ap-btn ap-btn--primary st-run', 'Create project →');
    go.type = 'submit';
    add(form, add(el('div', 'st-toolbar'), go, status));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      go.disabled = true;
      var body = { name: name.value, kind: picked(form, 'kind'), goal: goal.value, audience: audience.value,
        hosted: picked(form, 'where') === 'hosted', style: picked(form, 'style'), narration: picked(form, 'narration') };
      request('POST', 'project-new', null, body).then(function (r) {
        var id = r.project.id;
        if (!body.hosted) { location.hash = '#/p/' + encodeURIComponent(id); return; }
        var done = add(section('§ — CREATED'), headline('Project created,', 'one setting left.'),
          guide('To review it on ambientpixels.ai, add "' + id + '" to the Function App\'s STUDIO_PROJECTS setting. Run this once (it restarts the API; avoid the heartbeat at 00/06/12/18 UTC):'),
          el('pre', 'st-pre', 'MSYS_NO_PATHCONV=1 az functionapp config appsettings set --name ambientpixels-nova-api --resource-group ambientpixelsV2 --settings "STUDIO_PROJECTS=<the current list>,' + id + '"'));
        var open = el('a', 'ap-btn ap-btn--primary', 'Open the project →');
        open.href = '#/p/' + encodeURIComponent(id);
        show([add(done, open)]);
      }).catch(function (err) { go.disabled = false; flash(status, err.message); });
    });
    return Promise.resolve(show([add(s, form)]));
  }

  function viewNewVideo(id) {
    return getManifest(id).then(function (m) {
      setCrumbs([{ text: 'Studio', href: '#/' }, { text: m.name, href: '#/p/' + encodeURIComponent(id) }, { text: 'New video' }]);
      workspace(id, m, [], { page: 'new-video' });
      if (!LOCAL) return show([el('p', 'st-empty', 'New videos are made in the local studio (OPEN-STUDIO.cmd on your PC).')]);
      var s = add(section('§ — NEW VIDEO'), headline('A new video,', 'one title.'),
        guide('This adds a starting composition: a 6-second title slate in this project\'s style, numbered after the last video. It checks and renders as is; the real scenes are built from the script and the voiceover.',
          'Give it a title, then start on its script.'));
      var form = el('form', 'st-wizard');
    form.noValidate = true; // the server checks and explains; the browser's check fails silently
      var title = input('text', '', 'e.g. Reading your score');
      var status = el('span', 'st-note');
      var go = el('button', 'ap-btn ap-btn--primary st-run', 'Add video →');
      go.type = 'submit';
      add(form, field('Title', title), add(el('div', 'st-toolbar'), go, status));
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        go.disabled = true;
        request('POST', 'video-new', null, { project: id, title: title.value }).then(function (r) {
          delete manifestCache[id];
          location.hash = '#/p/' + encodeURIComponent(id) + '/v/' + encodeURIComponent(r.video.id) + '/script';
        }).catch(function (err) { go.disabled = false; flash(status, err.message); });
      });
      show([add(s, form)]);
    });
  }

  // ---- the project workspace: a rail (where you are) beside the page (the work) ----

  // Where a video stands, worked out from its files and the decisions made in the studio.
  var STAGES = [['script', 'Script'], ['voice', 'Voice'], ['scenes', 'Scenes'], ['review', 'Review'], ['deliver', 'Deliver']];
  function approvedDraft(v, events) {
    var ok = events.filter(function (e) { return e.type === 'decision' && e.video === v.id && e.decision === 'approved'; }).pop();
    return ok && v.drafts.filter(function (d) { return d.label === ok.draft; })[0];
  }
  function stagesOf(v, events) {
    var appr = approvedDraft(v, events);
    var done = {
      // Approved in the studio, or already carried through to a render (scripts approved before the studio existed).
      script: events.some(function (e) { return e.type === 'decision' && e.video === v.id && e.draft === 'script' && e.decision === 'approved'; }) || (!!v.script && v.drafts.length > 0),
      voice: (v.vo || []).length > 0,
      scenes: v.drafts.length > 0,
      review: !!appr,
      deliver: !!(appr && appr.files.master && appr.files.vtt)
    };
    var current = null;
    return STAGES.map(function (s) {
      var state = done[s[0]] ? 'done' : (current ? 'todo' : (current = s[0], 'current'));
      return { key: s[0], label: s[1], state: state };
    });
  }
  function currentStage(v, events) {
    var c = stagesOf(v, events).filter(function (s) { return s.state === 'current'; })[0];
    return c ? c.key : 'deliver';
  }
  var MARK = { done: '✓', current: '●', todo: '○' };

  var manifestCache = {};
  function getManifest(id) {
    var c = manifestCache[id];
    if (c && Date.now() - c.at < 15000) return c.p;
    var p = call('manifest', { project: id });
    manifestCache[id] = { p: p, at: Date.now() };
    p.catch(function () { delete manifestCache[id]; });
    return p;
  }

  function railLink(href, text, mark, active, cls) {
    var a = el('a', 'st-rail-link' + (cls ? ' ' + cls : ''));
    a.href = href;
    if (active) a.setAttribute('aria-current', 'page');
    add(a, el('span', 'st-rail-mark', mark || ''), el('span', null, text));
    return a;
  }

  // Build the workspace for a project and point `target` at its main column. sel = {page, video, stage}.
  function workspace(id, m, events, sel) {
    var P = '#/p/' + encodeURIComponent(id);
    var ws = el('div', 'st-ws');
    var rail = el('nav', 'st-rail');
    rail.setAttribute('aria-label', 'Project');
    add(rail, el('div', 'st-rail-h', m.name + '.'));
    [['', 'Overview'], ['make', 'Make'], ['library', 'Library'], ['captures', 'Captures'], ['docs', 'Docs']].forEach(function (x) {
      rail.appendChild(railLink(P + (x[0] ? '/' + x[0] : ''), x[1], '', !sel.video && sel.page === x[0]));
    });
    add(rail, el('div', 'st-rail-h', m.videos.length ? 'Videos' : 'No videos yet'));
    m.videos.forEach(function (v) {
      var st = stagesOf(v, events);
      var allDone = st.every(function (s) { return s.state === 'done'; });
      var isSel = sel.video === v.id;
      rail.appendChild(railLink(P + '/v/' + encodeURIComponent(v.id), v.title.replace(/^.*?:\s*/, '') || v.id, allDone ? '✓' : '●', isSel && !sel.stage, allDone ? 'st-rail-done' : ''));
      if (isSel) {
        var sub = el('div', 'st-rail-stages');
        st.forEach(function (s) {
          sub.appendChild(railLink(P + '/v/' + encodeURIComponent(v.id) + '/' + s.key, s.label, MARK[s.state], sel.stage === s.key, 'st-stage--' + s.state));
        });
        rail.appendChild(sub);
      }
    });
    var nv = railLink(P + '/new-video', 'New video', '+', sel.page === 'new-video', LOCAL ? '' : 'st-dim');
    rail.appendChild(nv);
    var main = el('div', 'st-ws-main');
    add(ws, rail, main);
    if (LOCAL) {
      ws.className += ' st-ws--chat';
      var defaultRole = preferredRole || ROLE_FOR[sel.stage || sel.page] || 'editor';
      preferredRole = null;
      ws.appendChild(chatPanel(id, [sel.video, sel.stage, sel.page].filter(Boolean).join(' / ') || 'the project overview', defaultRole));
    }
    app.textContent = '';
    app.appendChild(ws);
    target = main;
  }

  // ---- chat with Claude (local studio only) ----
  // The chat survives moving between pages of the same project: its state lives here, not in the page.
  var chatState = { project: null, id: null, after: 0, timer: null, events: [], info: null };
  var MODEL_NAMES = [['claude-sonnet-5-5', 'Sonnet 5.5 (balanced)'], ['claude-opus-5-5', 'Opus 5.5 (strongest)'], ['claude-haiku-5-5', 'Haiku 5.5 (fast, cheap)']];

  function chatPanel(project, context, defaultRole) {
    if (chatState.project !== project) {
      if (chatState.timer) clearInterval(chatState.timer);
      chatState = { project: project, id: null, after: 0, timer: null, events: [], info: null };
    }
    var panel = el('aside', 'st-chat');
    panel.setAttribute('aria-label', 'Chat with Claude');
    var head = el('div', 'st-chat-head');
    var log = el('div', 'st-chat-log');
    log.setAttribute('aria-live', 'polite');
    var box = el('textarea', 'st-input st-chat-input');
    box.rows = 3;
    box.placeholder = 'Ask Claude… (Ctrl+Enter to send)';
    var sendBtn = el('button', 'ap-btn ap-btn--primary st-run', 'Send →');
    sendBtn.type = 'button';
    var foot = el('div', 'st-chat-foot');
    var setup = el('div', 'st-chat-setup');
    var roleSel = el('select', 'st-input st-select');
    var model = select([['', 'The role\'s choice']].concat(MODEL_NAMES), '');
    var budget = input('number', '');
    budget.step = 'any'; budget.min = '0.25'; budget.max = '20';
    var past = el('select', 'st-input st-select');
    var roles = [];
    function roleHint() {
      var r = roles.filter(function (x) { return x.id === roleSel.value; })[0];
      if (!r) return;
      model.options[0].textContent = 'Role\'s choice (' + (MODEL_LABEL[r.model] || r.model) + ')';
      budget.placeholder = String(r.budget);
      box.placeholder = 'Ask the ' + r.name + '… (Ctrl+Enter to send)';
    }
    roleSel.addEventListener('change', roleHint);
    getTeam().then(function (t) {
      roles = t.roles.filter(function (r) { return r.enabled; });
      roles.forEach(function (r) { var o = el('option', null, r.name); o.value = r.id; if (r.id === defaultRole) o.selected = true; roleSel.appendChild(o); });
      roleHint();
    }).catch(function () {});
    add(setup, field('Talk to', roleSel), field('Model', model), field('Budget ($)', budget), field('Or continue', past));
    add(panel, head, setup, log, box, add(el('div', 'st-toolbar'), sendBtn, foot));

    function drawHead() {
      head.textContent = '';
      var i = chatState.info;
      add(head, el('div', 'st-rail-h', i && !i.closed && i.roleName ? i.roleName + '.' : 'The team.'));
      if (i && !i.closed) {
        add(head, el('span', 'st-note', i.status + ' · $' + (i.cost || 0).toFixed(2) + ' of $' + i.budget),
          button('st-link', 'Stop', function () { request('POST', 'chat-stop', null, { chat: i.id }); }),
          button('st-link', 'New chat', function () { request('POST', 'chat-end', null, { chat: i.id }).then(function () { chatState.id = null; chatState.info = null; chatState.events = []; chatState.after = 0; redraw(); }); }));
        setup.hidden = true;
      } else {
        add(head, el('span', 'st-note', i && i.closed ? 'This chat has ended (' + i.status + ', $' + (i.cost || 0).toFixed(2) + '). Send to start a new one.' : 'Pick who to talk to. Each role changes only its own part of the project without asking; anything else asks you first.'));
        setup.hidden = false;
      }
    }

    function line(cls, label, text) {
      var d = el('div', 'st-msg ' + cls);
      if (label) d.appendChild(el('div', 'st-msg-who', label));
      if (text != null) d.appendChild(typeof text === 'string' ? el('div', 'st-msg-text', text) : text);
      return d;
    }
    function diffView(diff) {
      var d = el('div', 'st-diff');
      if (diff.before) d.appendChild(el('pre', 'st-diff-del', diff.before));
      if (diff.after) d.appendChild(el('pre', 'st-diff-add', diff.after));
      return d;
    }
    function drawEvent(e) {
      if (e.type === 'user') return line('st-msg--user', 'You', e.text);
      if (e.type === 'assistant') return line('st-msg--claude', 'Claude', md(e.text));
      if (e.type === 'tool') return line('st-msg--tool', null, '→ ' + e.tool + (e.text ? ' ' + e.text : ''));
      if (e.type === 'tool-error') return line('st-msg--tool', null, '✗ ' + e.text);
      if (e.type === 'auto') {
        var d = line('st-msg--tool', null, '✎ edited ' + e.text.replace(/^.*?projects[\\/]/, 'projects/'));
        if (e.diff) { var det = el('details'); add(det, el('summary', 'st-note', 'show the change'), diffView(e.diff)); d.appendChild(det); }
        return d;
      }
      if (e.type === 'approval') {
        var card = el('div', 'st-approve st-approve--' + e.state);
        var who = (chatState.info && chatState.info.roleName) || 'Claude';
        add(card, el('div', 'st-msg-who', 'The ' + who + ' wants to ' + (e.kind === 'command' ? 'run a command' : e.kind === 'edit' ? 'edit a file outside its area' : 'use ' + e.tool)),
          el('pre', 'st-pre', e.kind === 'edit' ? e.text.replace(/^.*?[\\/]projects[\\/]/, 'projects/').replace(/\\/g, '/') : e.text));
        if (e.why) card.appendChild(el('div', 'st-note', e.why));
        if (e.diff) card.appendChild(diffView(e.diff));
        if (e.state === 'waiting') {
          add(card, add(el('div', 'st-toolbar'),
            button('ap-btn ap-btn--primary st-run', 'Approve', function () { decide(e.id, true); }),
            button('st-tab', 'Deny', function () { decide(e.id, false); })));
        } else card.appendChild(el('div', 'st-note', e.state === 'approved' ? '✓ Approved' : '✗ Denied'));
        return card;
      }
      if (e.type === 'result') return line('st-msg--tool', null, e.subtype === 'success' ? 'Done · $' + e.cost.toFixed(2) + ' so far' : e.subtype === 'error_max_budget_usd' ? 'Stopped: the chat reached its budget.' : 'Stopped (' + e.subtype + ').');
      if (e.type === 'error') return line('st-msg--tool', null, '✗ ' + e.text);
      return line('st-msg--tool', null, e.text || '');
    }
    function decide(aid, allow) { request('POST', 'chat-approve', null, { chat: chatState.id, approval: aid, allow: allow }).then(poll); }

    function redraw() {
      drawHead();
      log.textContent = '';
      if (!chatState.events.length) log.appendChild(el('p', 'st-empty', 'Ask for a change to this video, a script rewrite, an explanation of a QC failure… Claude reads the project\'s notes and your review notes first.'));
      chatState.events.forEach(function (e) { log.appendChild(drawEvent(e)); });
      log.scrollTop = log.scrollHeight;
    }
    function poll() {
      if (!chatState.id) return Promise.resolve();
      return call('chat', { id: chatState.id, after: chatState.after }).then(function (r) {
        chatState.info = r;
        if (r.events.length) {
          // An approval's state changes in place: replace any event we already hold.
          r.events.forEach(function (e) {
            var i = chatState.events.findIndex(function (x) { return x.seq === e.seq; });
            if (i >= 0) chatState.events[i] = e; else chatState.events.push(e);
          });
          chatState.after = r.events[r.events.length - 1].seq;
        }
        // Waiting approvals can change state without a new event: refresh them from the start.
        if (chatState.events.some(function (e) { return e.type === 'approval' && e.state === 'waiting'; })) chatState.after = Math.min(chatState.after, firstWaiting() - 1);
        var sig = [r.status, r.cost, r.closed, chatState.events.length].concat(chatState.events.map(function (e) { return e.state || ''; })).join('|');
        if (document.body.contains(panel) && sig !== panel.sig) { panel.sig = sig; redraw(); }
        if (r.closed && chatState.timer) { clearInterval(chatState.timer); chatState.timer = null; }
      }).catch(function () {});
    }
    function firstWaiting() { var w = chatState.events.filter(function (e) { return e.type === 'approval' && e.state === 'waiting'; })[0]; return w ? w.seq : chatState.after + 1; }
    function startPolling() { if (!chatState.timer) chatState.timer = setInterval(poll, 1000); }

    function sendNow() {
      var text = box.value.trim();
      if (!text) { box.focus(); return; }
      sendBtn.disabled = true;
      var live = chatState.info && !chatState.info.closed;
      var p = live
        ? request('POST', 'chat-send', null, { chat: chatState.id, text: text, context: context })
        : request('POST', 'chat-new', null, { project: project, role: roleSel.value, text: text, context: context, model: model.value || undefined,
          budget: budget.value === '' ? undefined : Number(budget.value), resume: past.value || undefined }).then(function (r) {
          chatState.id = r.id; chatState.info = r; chatState.events = []; chatState.after = 0;
        });
      p.then(function () { box.value = ''; startPolling(); return poll(); })
        .catch(function (err) { flash(foot, err.message); })
        .then(function () { sendBtn.disabled = false; });
    }
    sendBtn.addEventListener('click', sendNow);
    box.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendNow(); } });
    panel.prefill = function (text, role) {
      box.value = text;
      box.focus();
      var live = chatState.info && !chatState.info.closed;
      if (role && !live) { roleSel.value = role; roleHint(); }
      else if (role && live && chatState.info.role !== role) {
        var want = roles.filter(function (r) { return r.id === role; })[0];
        flash(foot, 'You\'re talking to the ' + chatState.info.roleName + '. For the ' + (want ? want.name : role) + ', press New chat first.');
      }
    };

    // Past chats for this project, to continue one.
    call('chats', { project: project }).then(function (r) {
      past.appendChild(add(el('option', null, 'A new chat'), null));
      past.firstChild.value = '';
      r.saved.forEach(function (s) {
        var who = roles.filter(function (x) { return x.id === s.role; })[0];
        var o = el('option', null, (who ? who.name + ': ' : '') + s.title.slice(0, 36) + ' · ' + when(s.startedAt) + ' · $' + (s.cost || 0).toFixed(2));
        o.value = s.sessionId;
        past.appendChild(o);
      });
      if (!chatState.id && r.live.length) { chatState.id = r.live[0].id; chatState.info = r.live[0]; startPolling(); poll(); }
    }).catch(function () {});

    redraw();
    if (chatState.id) { startPolling(); }
    return panel;
  }
  // Fill the chat box (and pick the role, when no chat is running). Nothing is sent until Chad presses Send.
  function prefillChat(text, role) {
    var p = document.querySelector('.st-chat');
    if (p && p.prefill) p.prefill(text, role);
  }

  function viewProject(id, page, arg) {
    return Promise.all([getManifest(id), loadEvents(id)]).then(function (both) {
      var m = both[0], events = both[1];
      var P = '#/p/' + encodeURIComponent(id);
      setCrumbs([{ text: 'Studio', href: '#/' }, { text: m.name, href: P }].concat(page ? [{ text: page === 'doc' ? baseName(arg) : page }] : []));
      workspace(id, m, events, { page: page === 'doc' ? 'docs' : page });
      if (page === 'make') {
        var mk = section('§ — MAKE');
        add(mk, headline('Make something,', 'on your PC.'),
          guide('Render a draft, check a video\'s scenes, snapshot frames, or make a music bed. Your PC runs one job at a time; the log shows each step.' +
            (LOCAL ? '' : ' From the website, jobs wait until the PC\'s worker is running.'), 'Pick a job, check the values, press Run.'),
          jobsPanel(id, m));
        return show([mk]);
      }
      if (page === 'library') {
        var nodes = [add(section('§ — LIBRARY'), headline('Everything else,', 'in one place.'),
          guide('Files that belong to no single draft: music beds, voice auditions, snapshots, comps. Listen to audio takes blind and pick one; your pick is recorded for Claude.'))];
        m.loose.forEach(function (group) { nodes.push(add(section('§ — ' + group.dir.toUpperCase()), gallery(id, group, events))); });
        if (!m.loose.length) nodes.push(el('p', 'st-empty', 'Nothing here yet.'));
        return show(nodes);
      }
      if (page === 'captures') {
        var cs = add(section('§ — CAPTURES'), headline('Real screens,', 'never faked.'),
          guide('Screenshots of the product, saved in this project\'s captures folder. Videos use real captures only; if a screen does not match the script, recapture it.',
            LOCAL ? null : 'Captures stay on the PC; open the local studio to see them.'));
        var gal = el('div', 'st-gallery');
        (m.captures || []).forEach(function (f) { gal.appendChild(fileTile(id, f, null, events, true)); });
        if (!(m.captures || []).length) cs.appendChild(el('p', 'st-empty', 'No captures in ' + 'projects/' + id + '/captures/ yet.'));
        return show([add(cs, gal)]);
      }
      if (page === 'docs') return show([docsList(id, m)]);
      if (page === 'doc') return viewDoc(id, arg);
      return show(overview(id, m, events));
    });
  }

  function overview(id, m, events) {
    var P = '#/p/' + encodeURIComponent(id);
    var s = section('§ — OVERVIEW');
    add(s, headline(m.name + ',', m.videos.length + (m.videos.length === 1 ? ' video.' : ' videos.')),
      guide('A project is a set of videos that share a look, a voice and one decisions log (NOTES.md). Each video moves through five stages: Script, Voice, Scenes, Review, Deliver.',
        m.videos.length ? 'Open the video marked ● below to pick up where it stands.' : 'Add the first video: + New video, in the rail on the left.'));
    var rows = el('div', 'st-rows');
    m.videos.forEach(function (v, i) {
      var st = stagesOf(v, events), cur = currentStage(v, events);
      var allDone = st.every(function (x) { return x.state === 'done'; });
      var label = allDone ? 'Delivered' : 'Next: ' + st.filter(function (x) { return x.key === cur; })[0].label;
      var meta = st.map(function (x) { return MARK[x.state] + ' ' + x.label; }).join('   ');
      add(rows, row(P + '/v/' + encodeURIComponent(v.id) + '/' + (allDone ? 'review' : cur), pad2(i + 1), v.title, meta, label, allDone ? '' : 'ap-status--beta'));
    });
    s.appendChild(rows);
    var nodes = [s];
    if (m.notes) {
      var brief = section('§ — THE BRIEF (NOTES.MD)');
      var holder = el('div', 'st-brief');
      brief.appendChild(holder);
      call('text', { project: id, path: m.notes }, 'text').then(function (t) { holder.appendChild(md(t)); })
        .catch(function () { holder.appendChild(el('p', 'st-empty', 'NOTES.md is on the PC only.')); });
      nodes.push(brief);
    }
    return nodes;
  }

  function docsList(id, m) {
    var P = '#/p/' + encodeURIComponent(id);
    var docs = [m.notes, m.readme].concat(m.questions || [], m.handoffs || []).filter(Boolean);
    docs.unshift('projects/' + id + '/feedback/REVIEW.md');
    var d = add(section('§ — DOCS'), headline('The paper trail,', 'readable.'),
      guide('NOTES.md is the decisions log. REVIEW.md collects your notes and approvals for Claude. A QUESTIONS file holds either/or questions you can answer with one click.'));
    var drows = el('div', 'st-rows');
    docs.forEach(function (p, i) {
      var q = /QUESTIONS/i.test(p);
      add(drows, row(P + '/doc/' + encodeURIComponent(p), pad2(i + 1), baseName(p),
        p.split('/').slice(2, -1).join('/') || 'project', q ? 'Answer' : 'Read', q ? 'ap-status--beta' : 'ap-status--archive'));
    });
    return add(d, drows);
  }

  // ---- a video's stages (Review is the player, further down) ----
  function viewStage(id, vid, stage, draft) {
    return Promise.all([getManifest(id), loadEvents(id)]).then(function (both) {
      var m = both[0], events = both[1];
      var v = m.videos.filter(function (x) { return x.id === vid; })[0];
      if (!v) throw new Error('No video ' + vid);
      stage = stage || currentStage(v, events);
      var P = '#/p/' + encodeURIComponent(id);
      setCrumbs([{ text: 'Studio', href: '#/' }, { text: m.name, href: P }, { text: v.id }, { text: stage }]);
      workspace(id, m, events, { video: v.id, stage: stage });
      if (stage === 'review') return viewVideo(id, m, events, v, draft);
      if (stage === 'script') return show(LOCAL ? writersRoom(id, m, v, events) : scriptStage(id, v));
      if (stage === 'voice') return show(voiceStage(id, v, events));
      if (stage === 'scenes') return show(scenesStage(id, m, v));
      return show(deliverStage(id, m, v, events));
    });
  }

  // ---- the Writer's room (local): edit, version, ask the Writer, hear it, approve it ----
  function writersRoom(id, m, v, events) {
    var P = '#/p/' + encodeURIComponent(id);
    var approved = events.filter(function (e) { return e.type === 'decision' && e.video === v.id && e.draft === 'script'; }).pop();
    var s = add(section('§ — SCRIPT'), headline(v.title + ',', 'the words.'),
      guide('The Writer\'s room. The script is what the narrator says, one paragraph per breath; edit it here, or ask the Writer with the buttons below (they fill in the chat on the right; you press Send). Every save keeps the previous version.',
        approved && approved.decision === 'approved' ? 'Approved. Next: the voice (Voice stage).' : 'Write or refine it, read it aloud, then approve it.'));
    var stats = el('p', 'st-note');
    var box = el('textarea', 'st-input st-script-edit');
    box.rows = 18;
    box.spellcheck = true;
    var status = el('span', 'st-note');
    var saveBtn = el('button', 'ap-btn ap-btn--primary st-run', 'Save →');
    saveBtn.type = 'button';
    var versions = el('select', 'st-input st-select st-versions');
    var cur = null, dirty = false;
    function count() {
      var words = box.value.split(/\s+/).filter(Boolean).length;
      stats.textContent = words + ' words · about ' + Math.round(words / 2.5) + ' s at a natural pace' + (dirty ? ' · unsaved' : '') + (cur ? ' · ' + cur.path : '');
    }
    function load(r) {
      cur = r; dirty = false;
      box.value = r.text;
      versions.textContent = '';
      var first = el('option', null, r.versions.length ? 'Earlier versions (' + r.versions.length + ')…' : 'No earlier versions yet');
      first.value = '';
      versions.appendChild(first);
      r.versions.forEach(function (x) { var o = el('option', null, when(x.at) + ' · ' + x.words + ' words'); o.value = x.name; versions.appendChild(o); });
      count();
    }
    function fetchScript() { return call('script', { project: id, video: v.id }).then(load); }
    box.addEventListener('input', function () { dirty = true; count(); });
    function save() {
      if (!cur) return;
      saveBtn.disabled = true;
      request('POST', 'script-save', null, { project: id, video: v.id, text: box.value, base: cur.hash })
        .then(function (r) { load(r); delete manifestCache[id]; flash(status, r.unchanged ? 'No changes to save.' : 'Saved. The previous version is kept.'); })
        .catch(function (err) { flash(status, err.message); })
        .then(function () { saveBtn.disabled = false; });
    }
    saveBtn.addEventListener('click', save);
    box.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });
    versions.addEventListener('change', function () {
      if (!versions.value) return;
      call('script-version', { project: id, video: v.id, name: versions.value }).then(function (r) {
        if (dirty && !window.confirm('Replace your unsaved text with this earlier version?')) return;
        box.value = r.text; dirty = true; count();
        flash(status, 'Loaded an earlier version. Save to make it current (today\'s text is kept as a version).');
      });
      versions.value = '';
    });
    // The Writer may change the file from the chat: pick that up, unless Chad has unsaved edits.
    var watch = setInterval(function () {
      if (dirty || !cur) return;
      call('script', { project: id, video: v.id }).then(function (r) { if (r.hash !== cur.hash) { load(r); flash(status, 'Updated: the script changed on disk (the Writer, probably).'); } }).catch(function () {});
    }, 4000);
    cleanup.push(function () { clearInterval(watch); });

    // The Writer's buttons: each fills in the chat; nothing is sent until Chad presses Send.
    var path = 'projects/' + id + '/script/' + v.id + '-voiceover.txt';
    var secs = input('number', '90');
    secs.className += ' st-input--short';
    var voice = select([['af_bella', 'Bella'], ['af_heart', 'Heart'], ['am_michael', 'Michael']], 'af_bella');
    var ask = add(el('div', 'st-toolbar st-writer-actions'),
      button('st-tab', 'Draft from the brief', function () {
        prefillChat('Draft the voiceover for "' + v.title + '" from the brief in projects/' + id + '/NOTES.md, following your brief. Save it to ' + path + '. If the brief doesn\'t say how long, ask me first.', 'writer');
      }),
      button('st-tab', 'Rewrite for the ear', function () {
        prefillChat('Rewrite ' + path + ' for the ear, following your brief. Keep every fact. Then tell me in a few bullets what you changed and anything you couldn\'t keep.', 'writer');
      }),
      add(el('span', 'st-inline'), button('st-tab', 'Fit to', function () {
        var n = Number(secs.value) || 90;
        prefillChat('Fit ' + path + ' to about ' + n + ' seconds (about ' + Math.round(n * 2.5) + ' words). Cut, don\'t cram. Tell me what you cut.', 'writer');
      }), secs, el('span', 'st-note', 's')),
      button('st-tab', 'Check every claim', function () {
        prefillChat('Check every claim in ' + path + '. Fill projects/' + id + '/script/' + v.id + '-SOURCES.md: each claim, where it is true, and its status. Flag anything you can\'t verify as numbered either/or questions.', 'researcher');
      }),
      add(el('span', 'st-inline'), button('st-tab', 'Read it aloud', function () {
        if (dirty) { flash(status, 'Save first: the voice reads the saved script.'); return; }
        request('POST', 'job', null, { project: id, kind: 'readaloud', video: v.id, voice: voice.value })
          .then(function (r) {
            flash(status, 'Reading it aloud (local voice, nothing leaves this PC). The take appears below in about a minute.');
            // Watch the job; when it's done, show the new take here without a reload.
            var t = setInterval(function () {
              call('jobs', { project: id }).then(function (j) {
                var me = j.jobs.filter(function (x) { return x.id === r.job.id; })[0];
                if (!me || me.status === 'queued' || me.status === 'running') return;
                clearInterval(t);
                if (me.status !== 'done') { flash(status, 'Read-aloud ' + me.status.replace(/-/g, ' ') + ': see Make for the log.'); return; }
                (me.outputs || []).forEach(function (p) { takes.insertBefore(fileTile(id, { path: p }, null, events, true), takes.firstChild); });
                if (!takesShown) { s.insertBefore(el('div', 'st-note st-notes-h', 'Read-aloud takes'), takes); takesShown = true; }
                flash(status, 'The take is ready below.');
              }).catch(function () {});
            }, 4000);
            cleanup.push(function () { clearInterval(t); });
          })
          .catch(function (err) { flash(status, err.message); });
      }), voice));

    var approve = button('st-tab', approved && approved.decision === 'approved' ? 'Approved ✓' : 'Approve script', function () {
      if (dirty) { flash(status, 'Save first, then approve.'); return; }
      post({ project: id, type: 'decision', video: v.id, draft: 'script', decision: 'approved', text: '' })
        .then(function () { approve.textContent = 'Approved ✓'; delete manifestCache[id]; flash(status, 'Script approved. Recorded in REVIEW.md.'); })
        .catch(function (err) { flash(status, err.message); });
    });

    // Read-aloud takes for this video, newest first.
    var takes = el('div', 'st-gallery');
    m.loose.forEach(function (g) {
      if (!/\/readaloud$/.test(g.dir)) return;
      g.files.filter(function (f) { return baseName(f.path).indexOf(v.id + '-') === 0; }).forEach(function (f) { takes.appendChild(fileTile(id, f, null, events, true)); });
    });

    add(s, stats, box, add(el('div', 'st-toolbar'), saveBtn, versions, approve, status), el('div', 'st-note st-notes-h', 'Ask the Writer'), ask);
    var takesShown = takes.childNodes.length > 0;
    if (takesShown) s.appendChild(el('div', 'st-note st-notes-h', 'Read-aloud takes'));
    s.appendChild(takes);
    if (v.sources) {
      var a = el('a', 'st-link', 'Where each claim comes from (' + baseName(v.sources) + ') →');
      a.href = P + '/doc/' + encodeURIComponent(v.sources);
      s.appendChild(a);
    }
    fetchScript().catch(function (err) { flash(status, err.message); });
    return [s];
  }

  function scriptStage(id, v) {
    var s = add(section('§ — SCRIPT'), headline(v.title + ',', 'the words.'),
      guide('The voiceover script: what the narrator says, one paragraph per breath. Timing comes from the recorded voice later, never from this text.',
        v.script ? 'Read it through. Editing and the Writer are in the local studio.' : 'No script yet. Write it in the local studio, with the Writer.'));
    if (v.script) {
      var holder = el('div');
      s.appendChild(holder);
      call('text', { project: id, path: v.script }, 'text').then(function (t) {
        var words = t.split(/\s+/).filter(Boolean).length;
        add(holder, el('p', 'st-note', words + ' words · about ' + Math.round(words / 2.5) + ' s at a natural pace · ' + v.script), el('pre', 'st-pre st-script', t));
      }).catch(function () { holder.appendChild(el('p', 'st-empty', 'The script is on the PC only.')); });
      if (v.sources) {
        var a = el('a', 'st-link', 'Where each claim comes from (' + baseName(v.sources) + ') →');
        a.href = '#/p/' + encodeURIComponent(id) + '/doc/' + encodeURIComponent(v.sources);
        s.appendChild(a);
      }
    }
    return [s];
  }

  function voiceStage(id, v, events) {
    var s = add(section('§ — VOICE'), headline('The narration,', 'the master clock.'),
      guide('The recorded voiceover. Every scene is timed to the words in this audio, so a new take means re-timing. Takes are listed newest first.',
        (v.vo || []).length ? 'Listen to the newest take. A change of voice or wording goes through Claude.' : 'No narration yet: pick a voice in the Library auditions, then render it.'));
    var gal = el('div', 'st-gallery');
    (v.vo || []).slice().sort(function (a, b) { return a.mtime < b.mtime ? 1 : -1; })
      .forEach(function (f) { gal.appendChild(fileTile(id, f, null, events, true)); });
    return [add(s, gal)];
  }

  function scenesStage(id, m, v) {
    var P = '#/p/' + encodeURIComponent(id);
    var s = add(section('§ — SCENES'), headline('Every frame,', 'on the words.'),
      guide('The composition: each frame starts on a line of the narration. The board lists them. Check the scenes before rendering; snapshot a few moments to see them without a full render.',
        v.drafts.length ? 'Happy with the scenes? Render a draft in Make, then review it.' : 'Check the scenes, then render the first draft in Make.'));
    var actions = el('div', 'st-toolbar');
    var status = el('span', 'st-note');
    var times = input('text', '', 'Snapshot at, e.g. 3, 10.5, 42');
    times.className += ' st-input--inline';
    function queue(body, label) {
      request('POST', 'job', null, body).then(function () { flash(status, label + ' queued. Watch it in Make.'); })
        .catch(function (e) { flash(status, 'Refused: ' + e.message); });
    }
    add(actions,
      button('st-tab', 'Check the scenes', function () { queue({ project: id, kind: 'check', video: v.id }, 'Check'); }),
      times,
      button('st-tab', 'Snapshot', function () {
        var t = times.value.split(/[\s,]+/).filter(Boolean).map(Number);
        if (!t.length) { times.focus(); return; }
        queue({ project: id, kind: 'snapshot', video: v.id, times: t }, 'Snapshot');
      }),
      status);
    s.appendChild(actions);

    // Snapshots of this video, newest first.
    var snaps = [];
    m.loose.forEach(function (g) { g.files.forEach(function (f) { if (/\/snapshots\//.test(f.path) && baseName(f.path).indexOf(v.id + '-') === 0) snaps.push(f); }); });
    if (snaps.length) {
      s.appendChild(el('div', 'st-note st-notes-h', 'Snapshots'));
      var gal = el('div', 'st-gallery');
      snaps.forEach(function (f) { gal.appendChild(fileTile(id, f, null, [], true)); });
      s.appendChild(gal);
    }
    var board = el('div', 'st-board');
    s.appendChild(el('div', 'st-note st-notes-h', 'The board'));
    s.appendChild(board);
    var src = v.timing ? call('text', { project: id, path: v.timing }, 'text').then(function (t) {
      return (JSON.parse(t).frames || []).map(function (f) { return { t: f.prog_start, name: f.n ? f.n + '.' : '', text: f.vo_actual || f.vo || f.name }; });
    }) : (v.drafts[0] && v.drafts[0].files.vtt ? call('text', { project: id, path: v.drafts[0].files.vtt.path }, 'text').then(cues) : Promise.resolve([]));
    src.then(function (rows) {
      if (!rows.length) { board.appendChild(el('p', 'st-empty', 'No frame timing or captions yet.')); return; }
      rows.forEach(function (b) {
        var r = el('a', 'st-cue');
        r.href = P + '/v/' + encodeURIComponent(v.id) + '/review';
        add(r, el('span', 'st-cue-t', mmss(b.t)), add(el('span', 'st-cue-x'), b.name ? el('b', null, b.name + ' ') : null, document.createTextNode(b.text)));
        board.appendChild(r);
      });
    }).catch(function () { board.appendChild(el('p', 'st-empty', 'Not uploaded yet.')); });
    return [s];
  }

  function deliverStage(id, m, v, events) {
    var appr = approvedDraft(v, events);
    var d = appr || v.drafts[0];
    var s = add(section('§ — DELIVER'), headline('Ready to ship,', 'or not yet.'),
      guide('A deliverable is the approved draft, mastered to -14 LUFS, with captions and a passing QC report. Releasing it (to a portal, a page or a client) stays a human step.',
        !appr ? 'Approve a draft in Review first.' : 'Check every line below is ticked, then release it your usual way.'));
    if (!d) return [add(s, el('p', 'st-empty', 'No drafts yet.'))];
    s.appendChild(el('p', 'st-note', (appr ? 'Approved: ' : 'Latest (not approved): ') + d.label + ' · ' + d.dir));
    var list = el('div', 'st-checklist');
    function item(ok, text) { list.appendChild(add(el('div', 'st-check st-check--' + (ok ? 'ok' : 'no')), el('span', 'st-rail-mark', ok ? '✓' : '○'), el('span', null, text))); }
    item(!!appr, 'Approved in Review');
    item(!!d.files.master, 'Mastered (-14 LUFS)' + (d.files.master ? ': ' + baseName(d.files.master.path) : ''));
    item(!!(d.files.vtt && d.files.srt), 'Captions (.vtt and .srt)');
    item(!!d.files.poster, 'Poster frame');
    var qcRow = el('div', 'st-check st-check--no');
    add(qcRow, el('span', 'st-rail-mark', '○'), el('span', null, d.files.qc ? 'QC report: reading…' : 'QC report'));
    list.appendChild(qcRow);
    if (d.files.qc && d.files.qc.cloud !== false) {
      call('text', { project: id, path: d.files.qc.path }, 'text').then(function (t) {
        var pass = !/\|\s*FAIL\s*\|/.test(t);
        qcRow.className = 'st-check st-check--' + (pass ? 'ok' : 'no');
        qcRow.firstChild.textContent = pass ? '✓' : '✗';
        qcRow.lastChild.textContent = 'QC report: ' + (pass ? 'every check passes' : 'has a FAIL; read it');
      }).catch(function () {});
    }
    return [add(s, list)];
  }

  // ---- jobs: pick a recipe, fill in checked values; the PC runs it (one at a time) ----
  var KINDS = [['draft', 'Render a draft'], ['check', 'Check the scenes'], ['snapshot', 'Snapshot frames'], ['music', 'Make a music bed']];
  var MOODS = ['ambient', 'lofi', 'upbeat', 'cinematic', 'tense'];

  function field(labelText, input) {
    var f = el('label', 'st-field');
    add(f, el('span', 'st-label', labelText), input);
    return f;
  }
  function input(type, value, placeholder) {
    var i = el('input', 'st-input');
    i.type = type; i.value = value == null ? '' : value;
    if (placeholder) i.placeholder = placeholder;
    return i;
  }
  function select(options, value) {
    var s = el('select', 'st-input st-select');
    options.forEach(function (o) { var opt = el('option', null, o[1]); opt.value = o[0]; if (o[0] === value) opt.selected = true; s.appendChild(opt); });
    return s;
  }
  function nextLabel(v) {
    var max = 0;
    (v ? v.drafts : []).forEach(function (d) { var x = /^draft(\d+)$/.exec(d.label); if (x) max = Math.max(max, Number(x[1])); });
    return 'draft' + (max + 1);
  }

  function jobsPanel(id, m) {
    var wrap = el('div', 'st-jobs');
    var form = el('form', 'st-job-form');
    form.noValidate = true; // the server checks and explains; the browser's check fails silently
    var kind = select(KINDS, m.videos.length ? 'draft' : 'music');
    var video = select(m.videos.map(function (v) { return [v.id, v.id]; }), m.videos[0] && m.videos[0].id);
    var vOf = function () { return m.videos.filter(function (v) { return v.id === video.value; })[0]; };
    var label = input('text', nextLabel(vOf()));
    var latestDir = function () { var v = vOf(), d = v && v.drafts[0]; return d ? d.dir.split('/').slice(2).join('/') : ''; };
    var subdir = input('text', latestDir(), 'none');
    var quality = select([['draft', 'Draft'], ['delivery', 'Delivery']], 'draft');
    var times = input('text', '', 'e.g. 3, 10.5, 42');
    var mood = select(MOODS.map(function (x) { return [x, x]; }), 'ambient');
    var duration = input('number', '60');
    var seed = input('number', String(1000 + Math.floor(Math.random() * 9000)));
    var name = input('text', 'bed');
    video.addEventListener('change', function () { label.value = nextLabel(vOf()); subdir.value = latestDir(); });

    var groups = {
      video: field('Video', video), label: field('Label', label), subdir: field('Folder under renders/', subdir), quality: field('Quality', quality),
      times: field('Times (s)', times), mood: field('Mood', mood), duration: field('Seconds', duration), seed: field('Seed', seed), name: field('Name', name)
    };
    var SHOWN = { draft: ['video', 'label', 'subdir', 'quality'], check: ['video'], snapshot: ['video', 'times'], music: ['mood', 'duration', 'seed', 'name'] };
    function relayout() { Object.keys(groups).forEach(function (k) { groups[k].hidden = SHOWN[kind.value].indexOf(k) === -1; }); }
    kind.addEventListener('change', relayout);
    var status = el('span', 'st-note');
    var run = el('button', 'ap-btn ap-btn--primary st-run', 'Run →');
    run.type = 'submit';
    add(form, field('Job', kind));
    Object.keys(groups).forEach(function (k) { form.appendChild(groups[k]); });
    add(form, add(el('div', 'st-toolbar'), run, status));
    relayout();
    if (!m.videos.length) Array.prototype.forEach.call(kind.options, function (o) { o.disabled = o.value !== 'music'; });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var k = kind.value, body = { project: id, kind: k };
      if (k !== 'music') body.video = video.value;
      if (k === 'draft') { body.label = label.value.trim(); body.subdir = subdir.value.trim(); body.quality = quality.value; }
      if (k === 'snapshot') body.times = times.value.split(/[\s,]+/).filter(Boolean).map(Number);
      if (k === 'music') { body.mood = mood.value; body.duration = Number(duration.value); body.seed = Number(seed.value); body.name = name.value.trim(); }
      run.disabled = true;
      request('POST', 'job', null, body).then(function (r) {
        flash(status, 'Queued ' + r.job.kind + (LOCAL ? '.' : '. The PC picks it up within 30 s.'));
        if (k === 'draft') label.value = label.value.replace(/(\d+)$/, function (d) { return String(Number(d) + 1); });
        refresh();
      }).catch(function (err) { flash(status, 'Refused: ' + err.message); }).then(function () { run.disabled = false; });
    });

    var list = el('div', 'st-rows st-joblist');
    var open = {};
    function refresh() {
      return call('jobs', { project: id }).then(function (r) {
        list.textContent = '';
        if (!r.jobs.length) { list.appendChild(el('p', 'st-empty', 'No jobs yet.')); return; }
        r.jobs.forEach(function (j) { list.appendChild(jobRow(id, j, open, refresh)); });
      }).catch(function () {});
    }
    refresh();
    var timer = setInterval(refresh, 4000);
    cleanup.push(function () { clearInterval(timer); });
    return add(wrap, form, list);
  }

  var JOB_STATUS = { queued: 'ap-status--archive', running: 'ap-status--beta', done: '', 'done-with-warnings': 'ap-status--beta', failed: 'ap-status--archive', cancelled: 'ap-status--archive' };
  function jobRow(id, j, open, refresh) {
    var r = el('div', 'st-job');
    var what = j.kind + ' · ' + (j.video || (j.name + ' · ' + j.mood + ' · seed ' + j.seed)) + (j.label ? ' · ' + j.label : '');
    var head = button('st-job-head', '', function () { open[j.id] = !open[j.id]; logEl.hidden = !open[j.id]; });
    add(head, el('span', 'ap-status ' + (JOB_STATUS[j.status] || ''), j.status.replace(/-/g, ' ') + (j.step ? ' · ' + j.step : '')),
      el('span', 'st-job-what', what), el('span', 'st-note', when(j.createdAt)));
    r.appendChild(head);
    var tools = el('div', 'st-toolbar');
    (j.outputs || []).forEach(function (p) { tools.appendChild(outputLink(id, j, p)); });
    if (j.status === 'queued' || j.status === 'running') {
      tools.appendChild(button('st-link', j.cancelRequested ? 'Cancelling…' : 'Cancel', function (e) {
        e.target.disabled = true;
        request('POST', 'job-cancel', null, { project: id, id: j.id }).then(refresh);
      }));
    }
    if (tools.childNodes.length) r.appendChild(tools);
    var logEl = el('pre', 'st-pre st-log', j.log || 'No output yet.');
    logEl.hidden = !open[j.id];
    r.appendChild(logEl);
    return r;
  }
  function outputLink(id, j, p) {
    var name = baseName(p);
    if (/-master\.mp4$|\.mp4$/.test(p) && j.video && j.label) {
      var a = el('a', 'st-link', 'Watch ' + name);
      a.href = '#/p/' + encodeURIComponent(id) + '/v/' + encodeURIComponent(j.video) + '/d/' + encodeURIComponent(j.label);
      return a;
    }
    if (/\.md$/.test(p)) { var d = el('a', 'st-link', 'Read ' + name); d.href = '#/p/' + encodeURIComponent(id) + '/doc/' + encodeURIComponent(p); return d; }
    return button('st-link', 'Open ' + name, function () {
      call('media', { project: id, path: p }).then(function (r) { window.open(r.url, '_blank', 'noopener'); })
        .catch(function () { alert('Not uploaded yet: the PC syncs it in a moment.'); });
    });
  }

  // A folder of loose files. Audio gets a Pick button and a blind mode (shuffled, names hidden as A, B, C).
  function gallery(project, group, events) {
    var wrap = el('div');
    var audio = group.files.filter(function (f) { return /\.(mp3|wav)$/i.test(f.path); });
    var gal = el('div', 'st-gallery');
    var blind = false;
    function draw() {
      gal.textContent = '';
      var files = group.files.slice();
      if (blind) files = audio.slice().sort(function () { return Math.random() - 0.5; });
      files.forEach(function (f, i) { gal.appendChild(fileTile(project, f, blind ? 'Take ' + String.fromCharCode(65 + i) : null, events)); });
    }
    if (audio.length > 1) {
      var bar = el('div', 'st-toolbar');
      add(bar, button('st-tab', 'Blind listen', function (e) {
        blind = !blind;
        e.target.setAttribute('aria-pressed', blind ? 'true' : 'false');
        e.target.textContent = blind ? 'Show names' : 'Blind listen';
        draw();
      }));
      wrap.appendChild(bar);
    }
    draw();
    return add(wrap, gal);
  }

  function fileTile(project, f, alias, events, noPick) {
    var fig = el('figure');
    var name = baseName(f.path);
    var ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    var isAudio = ext === 'mp3' || ext === 'wav';
    var cap = el('figcaption', 'st-note', (alias || name) + (f.cloud === false ? ' · on the PC only' : ''));
    fig.appendChild(cap);
    if (f.cloud === false) return fig;
    if (['png', 'jpg', 'webp'].indexOf(ext) !== -1 || isAudio) {
      call('media', { project: project, path: f.path }).then(function (r) {
        var media = isAudio ? el('audio') : el('img');
        media.src = r.url;
        if (isAudio) media.controls = true; else media.alt = name;
        fig.insertBefore(media, cap);
      }).catch(function () { cap.textContent = (alias || name) + ' · not uploaded yet'; });
    }
    var picked = events.filter(function (e) { return e.type === 'pick' && e.path === f.path; }).length;
    if (noPick) return fig;
    add(fig, button('st-link', picked ? 'Picked ✓' : 'Pick this', function (e) {
      var b = e.target;
      b.disabled = true;
      post({ project: project, type: 'pick', path: f.path, text: alias ? 'picked blind as ' + alias : '' })
        .then(function () { flash(b, 'Picked ✓'); }).catch(function (err) { b.disabled = false; flash(b, 'Failed: ' + err.message); });
    }));
    return fig;
  }

  function viewDoc(id, path) {
    var name = baseName(path);
    return Promise.all([getManifest(id), call('text', { project: id, path: path }, 'text'), loadEvents(id)]).then(function (r) {
      var m = r[0], text = r[1], events = r[2];
      setCrumbs([{ text: 'Studio', href: '#/' }, { text: m.name, href: '#/p/' + encodeURIComponent(id) }, { text: name }]);
      var s = section('§ — ' + path.toUpperCase());
      if (/QUESTIONS/i.test(path)) add(s, questions(id, path, text, events));
      else add(s, md(text));
      show([s]);
    }, function (e) {
      if (e instanceof NeedKey) throw e;
      var s = section('§ — ' + path.toUpperCase());
      show([add(s, el('p', 'st-empty', e.status === 404 ? 'Nothing here yet.' : e.message))]);
    });
  }

  // A QUESTIONS file: "**N. Title**" opens a question, "(a)", "(b)" name its options, "*Recommend (x).*" marks one.
  function questions(project, path, text, events) {
    var wrap = el('div', 'st-questions');
    var parts = text.replace(/\r/g, '').split(/\n(?=\*\*\d+\.)/);
    wrap.appendChild(md(parts.shift() || ''));
    parts.forEach(function (block) {
      var n = Number(/^\*\*(\d+)\./.exec(block)[1]);
      var q = el('div', 'st-q');
      q.appendChild(md(block));
      var letters = [], re = /\(([a-h])\)/g, x;
      while ((x = re.exec(block))) if (letters.indexOf(x[1]) === -1) letters.push(x[1]);
      var rec = (/Recommend[^(]*\(([a-h])\)/i.exec(block) || [])[1];
      var answered = events.filter(function (e) { return e.type === 'answer' && e.file === path && e.n === n; }).pop();
      var bar = el('div', 'st-toolbar');
      var status = el('span', 'st-note', answered ? 'Answered: ' + (answered.choice === 'other' ? answered.text : '(' + answered.choice + ')') + (answered.pending ? ' · waiting for the PC' : '') : '');
      var other = el('input', 'st-input st-input--inline');
      other.placeholder = 'Or write another answer';
      function send(choice) {
        if (choice === 'other' && !other.value.trim()) { other.focus(); return; }
        post({ project: project, type: 'answer', file: path, n: n, choice: choice, text: choice === 'other' ? other.value : '' })
          .then(function (e) { flash(status, 'Answered: ' + (choice === 'other' ? e.text : '(' + choice + ')')); })
          .catch(function (err) { flash(status, 'Failed: ' + err.message); });
      }
      letters.forEach(function (l) {
        var b = button('st-tab' + (l === rec ? ' st-tab--rec' : ''), '(' + l + ')' + (l === rec ? ' recommended' : ''), function () { send(l); });
        bar.appendChild(b);
      });
      add(bar, other, button('st-tab', 'Send', function () { send('other'); }), status);
      q.appendChild(bar);
      wrap.appendChild(q);
    });
    return wrap;
  }

  // The Review stage: a draft beside its board, notes and decisions. (Called from viewStage.)
  function viewVideo(id, m, events, v, wantDraft) {
    return Promise.resolve().then(function () {
      var s = section('§ — REVIEW');
      add(s, headline(v.title + ',', v.drafts.length + (v.drafts.length === 1 ? ' draft.' : ' drafts.')),
        guide('Watch a draft. Pause anywhere and press N to leave a note at that moment. Approve the draft when it is right, or request changes. Pick another draft on the right to compare at the same moment.',
          'Your notes and decisions go to REVIEW.md, which Claude reads before the next round.'));
      var grid = el('div', 'st-video');
      var player = el('div', 'st-player');
      var video = el('video');
      video.controls = true;
      video.preload = 'metadata';

      // Toolbar: what's playing, a note at the current time, and the draft decision.
      var label = el('span', 'st-note', 'Pick a draft.');
      var noteInput = el('input', 'st-input st-input--inline');
      noteInput.placeholder = 'Note at 0:00 (press N)';
      var noteStatus = el('span', 'st-note');
      var noteAt = 0;
      var current = null;
      function grabTime() { noteAt = video.currentTime || 0; noteInput.placeholder = 'Note at ' + mmss(noteAt) + ' (Enter to save)'; }
      noteInput.addEventListener('focus', function () { video.pause(); grabTime(); });
      noteInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { noteInput.blur(); return; }
        if (e.key !== 'Enter' || !noteInput.value.trim() || !current) return;
        var text = noteInput.value;
        noteInput.value = '';
        post({ project: id, type: 'note', video: v.id, draft: current.label, t: noteAt, text: text }).then(function (ev) {
          events.push(ev);
          flash(noteStatus, 'Saved at ' + mmss(ev.t) + (LOCAL ? '' : ' · reaches the PC within a minute'));
          drawNotes();
          noteInput.blur();
        }).catch(function (err) { noteInput.value = text; flash(noteStatus, 'Failed: ' + err.message); });
      });
      function decide(decision) {
        if (!current) return;
        var why = decision === 'changes' ? window.prompt('What needs to change? (optional)') : '';
        if (why === null) return;
        post({ project: id, type: 'decision', video: v.id, draft: current.label, decision: decision, text: why || '' }).then(function (ev) {
          events.push(ev);
          flash(noteStatus, decision === 'approved' ? 'Approved ' + current.label + '.' : 'Changes requested on ' + current.label + '.');
          drawNotes();
        }).catch(function (err) { flash(noteStatus, 'Failed: ' + err.message); });
      }
      var bar = add(el('div', 'st-toolbar'), label, noteInput,
        button('st-tab', 'Approve draft', function () { decide('approved'); }),
        button('st-tab', 'Request changes', function () { decide('changes'); }),
        LOCAL ? button('st-tab', 'Send my notes to Claude', function () {
          prefillChat('Read my notes on ' + v.id + (current ? ' ' + current.label : '') + ' in projects/' + id + '/feedback/REVIEW.md, then make the fixes in the composition. Tell me which job to run when you\'re done.');
        }) : null);
      add(player, video, bar, noteStatus);

      // Tabs under the player.
      var tabs = el('div', 'st-tabs');
      var pane = el('div', 'st-pane');
      var TABS = [['board', 'Board'], ['notes', 'Notes'], ['qc', 'QC'], ['script', 'Script'], ['align', 'Align']];
      var tabButtons = {}, active = 'board';
      TABS.forEach(function (t) {
        tabButtons[t[0]] = add(tabs, button('st-tab', t[1], function () { setTab(t[0]); })).lastChild;
      });
      add(player, tabs, pane);

      var board = [], boardRows = [];
      function setTab(name) {
        active = name;
        Object.keys(tabButtons).forEach(function (k) { tabButtons[k].setAttribute('aria-selected', k === name ? 'true' : 'false'); });
        pane.textContent = '';
        boardRows = [];
        if (name === 'board') drawBoard();
        else if (name === 'notes') drawNotes();
        else if (name === 'qc') textTab(current && current.files.qc, 'No QC report for this draft.');
        else if (name === 'script') textTab(v.script && { path: v.script }, 'No script file.', true);
        else if (name === 'align') {
          if (!v.align.length) pane.appendChild(el('p', 'st-empty', 'No alignment report.'));
          v.align.forEach(function (p) { textTab({ path: p }, '', false, true); });
        }
      }
      function textTab(file, empty, plain, append) {
        if (!file || file.cloud === false) { pane.appendChild(el('p', 'st-empty', file ? 'On the PC only.' : empty)); return; }
        var holder = el('div');
        pane.appendChild(holder);
        call('text', { project: id, path: file.path }, 'text').then(function (t) {
          if (append) holder.appendChild(el('div', 'st-note', baseName(file.path)));
          holder.appendChild(plain ? el('pre', 'st-pre', t) : md(t));
        }).catch(function () { holder.appendChild(el('p', 'st-empty', 'Not uploaded yet.')); });
      }

      // The board: the edit plan's frames when the video has a timing file, otherwise the draft's captions.
      function drawBoard() {
        if (!board.length) { pane.appendChild(el('p', 'st-empty', 'No frame timing or captions for this draft.')); return; }
        var list = el('div', 'st-board');
        board.forEach(function (b) {
          var r = button('st-cue', '', function () { video.currentTime = b.t + 0.05; video.play(); });
          add(r, el('span', 'st-cue-t', mmss(b.t)), add(el('span', 'st-cue-x'), b.name ? el('b', null, b.name + ' ') : null, document.createTextNode(b.text)));
          boardRows.push([b, r]);
          list.appendChild(r);
        });
        pane.appendChild(list);
        markBoard();
      }
      function markBoard() {
        if (active !== 'board') return;
        var t = video.currentTime, cur = null;
        boardRows.forEach(function (br) { if (br[0].t <= t + 0.01) cur = br; });
        boardRows.forEach(function (br) { br[1].setAttribute('aria-current', br === cur ? 'true' : 'false'); });
      }
      video.addEventListener('timeupdate', markBoard);

      function drawNotes() {
        if (active !== 'notes') return;
        pane.textContent = '';
        var mine = events.filter(function (e) { return (e.type === 'note' || e.type === 'decision') && e.video === v.id; });
        if (!mine.length) { pane.appendChild(el('p', 'st-empty', 'No notes yet. Pause anywhere and press N.')); return; }
        var labels = [];
        mine.forEach(function (e) { if (labels.indexOf(e.draft) === -1) labels.push(e.draft); });
        labels.sort(function (a, b) { return (b === (current && current.label)) - (a === (current && current.label)); });
        labels.forEach(function (lab) {
          pane.appendChild(el('div', 'st-note st-notes-h', lab + (current && lab === current.label ? ' · playing' : '')));
          mine.filter(function (e) { return e.draft === lab; }).sort(function (a, b) { return (a.t || 0) - (b.t || 0); }).forEach(function (e) {
            var text = e.type === 'decision' ? (e.decision === 'approved' ? 'APPROVED' : 'CHANGES REQUESTED') + (e.text ? ': ' + e.text : '') : e.text;
            var r = button('st-cue', '', function () {
              if (e.type !== 'note') return;
              var d = v.drafts.filter(function (x) { return x.label === e.draft; })[0];
              if (d && d !== current) play(d, e.t); else { video.currentTime = e.t; video.play(); }
            });
            add(r, el('span', 'st-cue-t', e.type === 'note' ? mmss(e.t) : '—'), el('span', 'st-cue-x', text + (e.pending ? ' · waiting for the PC' : '')));
            pane.appendChild(r);
          });
        });
      }

      // Drafts. Switching keeps the time code, so two drafts compare at the same moment.
      var list = el('div', 'st-drafts');
      var buttons = [];
      v.drafts.forEach(function (d) {
        var file = d.files.master || d.files.raw;
        var b = el('button', 'st-draft');
        b.type = 'button';
        var where = !file ? 'no video' : file.cloud === false ? 'PC only' : d.files.master ? 'master' : 'raw';
        var verdict = events.filter(function (e) { return e.type === 'decision' && e.video === v.id && e.draft === d.label; }).pop();
        add(b, el('b', null, d.label), el('span', 'st-note', verdict ? (verdict.decision === 'approved' ? 'approved' : 'changes') : where),
          el('span', 'st-note', when(d.mtime)), el('span', 'st-note', d.dir.split('/').slice(2).join('/') || ''));
        if (!file || file.cloud === false) b.disabled = true;
        b.addEventListener('click', function () { play(d, video.currentTime); });
        buttons.push(b);
        list.appendChild(b);
      });

      function play(d, at) {
        current = d;
        location.replace('#/p/' + encodeURIComponent(id) + '/v/' + encodeURIComponent(v.id) + '/review/d/' + encodeURIComponent(d.label));
        buttons.forEach(function (b, i) { b.setAttribute('aria-current', v.drafts[i] === d ? 'true' : 'false'); });
        var file = d.files.master || d.files.raw;
        label.textContent = d.label + (d.files.master ? ' · mastered' : ' · raw render');
        Array.prototype.slice.call(video.querySelectorAll('track')).forEach(function (t) { t.remove(); });
        call('media', { project: id, path: file.path }).then(function (r) {
          video.src = r.url;
          if (at) video.addEventListener('loadedmetadata', function once() { video.removeEventListener('loadedmetadata', once); video.currentTime = Math.min(at, video.duration || at); }, { once: true });
        });
        board = [];
        var timing = v.timing ? call('text', { project: id, path: v.timing }, 'text').then(function (t) {
          return (JSON.parse(t).frames || []).map(function (f) { return { t: f.prog_start, name: f.n ? f.n + '.' : '', text: f.vo_actual || f.vo || f.name }; });
        }).catch(function () { return null; }) : Promise.resolve(null);
        var vtt = d.files.vtt && d.files.vtt.cloud !== false ? call('text', { project: id, path: d.files.vtt.path }, 'text').catch(function () { return null; }) : Promise.resolve(null);
        Promise.all([timing, vtt]).then(function (r) {
          if (r[1]) {
            // Captions play from a blob: URL, so they need no cross-origin setup.
            var t = el('track');
            t.kind = 'captions'; t.label = 'English'; t.srclang = 'en'; t.default = true;
            t.src = URL.createObjectURL(new Blob([r[1]], { type: 'text/vtt' }));
            video.appendChild(t);
          }
          board = r[0] || (r[1] ? cues(r[1]) : []);
          setTab(active);
        });
      }

      add(grid, player, list);
      show([add(s, grid)]);

      function onKey(e) {
        var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
        if (!typing && (e.key === 'n' || e.key === 'N') && current) { e.preventDefault(); noteInput.focus(); }
      }
      document.addEventListener('keydown', onKey);
      cleanup.push(function () { document.removeEventListener('keydown', onKey); });

      var pick = v.drafts.filter(function (d) { return d.label === wantDraft; })[0] ||
        v.drafts.filter(function (d) { var f = d.files.master || d.files.raw; return f && f.cloud !== false; })[0];
      if (pick) play(pick); else setTab('board');
    });
  }

  // WebVTT → [{t, text}] for the board when a video has no frame timing.
  function cues(vtt) {
    var out = [];
    vtt.replace(/\r/g, '').split(/\n\n+/).forEach(function (block) {
      var m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)\s+-->/.exec(block);
      if (!m) return;
      var t = Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number('0.' + m[4]);
      var text = block.split('\n').filter(function (l) { return l && !/-->/.test(l) && !/^(WEBVTT|\d+)$/.test(l.trim()); }).join(' ');
      if (text) out.push({ t: t, text: text });
    });
    return out;
  }

  // ---- router ----
  function route() {
    cleanup.splice(0).forEach(function (f) { f(); });
    var h = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    var p;
    if (!LOCAL && !getKey()) p = viewKey(false);
    // #/p/<id>/v/<video>[/<stage>][/d/<draft>]   (older links: #/p/<id>/v/<video>/d/<draft> open Review)
    else if (h[0] === 'p' && h[1] && h[2] === 'v' && h[3]) {
      var stage = h[4] === 'd' ? 'review' : h[4];
      var di = h.indexOf('d', 4);
      p = viewStage(h[1], h[3], STAGES.some(function (s) { return s[0] === stage; }) ? stage : null, di > 0 ? h[di + 1] : null);
    }
    else if (h[0] === 'p' && h[1] && h[2] === 'new-video') p = viewNewVideo(h[1]);
    else if (h[0] === 'p' && h[1]) p = viewProject(h[1], h[2] || '', h[3]);
    else if (h[0] === 'new') { target = app; p = viewNewProject(); }
    else if (h[0] === 'team' && h[1]) p = viewRole(h[1]);
    else if (h[0] === 'team') p = viewTeam();
    else { target = app; p = viewProjects(); }
    p.catch(function (e) {
      if (e instanceof NeedKey) return viewKey(!!getKey());
      show([add(section('§ — ERROR'), el('p', 'st-empty', e.message))]);
    });
    if (h[0] && (LOCAL || getKey())) call('projects').then(function (r) { showWorker(r.worker); }).catch(function () {});
  }

  // The guide: the ? button, and once on a first visit (remembered in this browser only).
  var help = document.getElementById('help');
  document.getElementById('help-open').addEventListener('click', function () { help.showModal(); });
  try {
    if (!localStorage.getItem('ap_studio_seen_help') && (LOCAL || getKey())) {
      localStorage.setItem('ap_studio_seen_help', '1');
      help.showModal();
    }
  } catch (e) {}

  // The draft is recorded in the hash with location.replace; that fires hashchange, which must not re-render.
  var lastHash = null;
  window.addEventListener('hashchange', function () {
    var base = function (x) { return x.replace(/\/d\/[^/]*$/, ''); };
    if (lastHash !== null && base(location.hash) === base(lastHash)) { lastHash = location.hash; return; }
    lastHash = location.hash;
    route();
  });
  lastHash = location.hash;
  route();
})();
