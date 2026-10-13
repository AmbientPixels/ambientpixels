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
  function show(nodes) { app.textContent = ''; nodes.forEach(function (n) { app.appendChild(n); }); }
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
      add(s, headline('Every video in production,', 'one studio.'));
      var rows = el('div', 'st-rows');
      r.projects.forEach(function (p, i) {
        var meta = p.videos + ' videos · ' + p.drafts + ' drafts · scanned ' + when(p.scannedAt);
        var hosted = p.hosted !== false;
        add(rows, row('#/p/' + encodeURIComponent(p.id), pad2(i + 1), p.name + '.', meta,
          LOCAL ? (hosted ? 'Hosted' : 'Local only') : 'Hosted', hosted ? 'st-status--cloud' : 'st-status--pc'));
      });
      if (!r.projects.length) add(rows, el('p', 'st-empty', 'No projects yet. The PC uploads them.'));
      var nodes = [add(s, rows)];
      if (!LOCAL) {
        var foot = el('p', 'st-note st-foot');
        add(foot, button('st-link', 'Forget the studio key on this browser', function () { setKey(''); route(); }));
        nodes.push(foot);
      }
      show(nodes);
    });
  }

  function viewProject(id) {
    return Promise.all([call('manifest', { project: id }), loadEvents(id)]).then(function (both) {
      var m = both[0], events = both[1];
      setCrumbs([{ text: 'Studio', href: '#/' }, { text: m.name }]);
      var nodes = [], n = 1;
      var s = section('§ ' + pad2(n++) + ' — ' + m.name.toUpperCase());
      add(s, headline(m.videos.length + (m.videos.length === 1 ? ' video,' : ' videos,'), 'every draft.'));
      var rows = el('div', 'st-rows');
      m.videos.forEach(function (v, i) {
        var latest = v.drafts[0];
        var notes = events.filter(function (e) { return e.type === 'note' && e.video === v.id; }).length;
        var decided = events.filter(function (e) { return e.type === 'decision' && e.video === v.id; }).pop();
        var meta = v.id + ' · ' + v.drafts.length + ' drafts' + (latest ? ' · latest ' + latest.label + ', ' + when(latest.mtime) : '') + (notes ? ' · ' + notes + ' notes' : '');
        var status = decided ? (decided.decision === 'approved' ? 'Approved ' + decided.draft : 'Changes on ' + decided.draft) : latest ? latest.label : 'No render';
        add(rows, row('#/p/' + encodeURIComponent(id) + '/v/' + encodeURIComponent(v.id), pad2(i + 1), v.title, meta,
          status, decided && decided.decision === 'approved' ? '' : latest ? 'ap-status--beta' : 'ap-status--archive'));
      });
      if (!m.videos.length) add(rows, el('p', 'st-empty', 'No compositions in series/ yet.'));
      nodes.push(add(s, rows));

      nodes.push(add(section('§ ' + pad2(n++) + ' — JOBS'), jobsPanel(id, m)));

      var docs =[m.notes, m.readme].concat(m.questions || [], m.handoffs || []).filter(Boolean);
      docs.unshift('projects/' + id + '/feedback/REVIEW.md');
      var d = section('§ ' + pad2(n++) + ' — DOCUMENTS');
      var drows = el('div', 'st-rows');
      docs.forEach(function (p, i) {
        var q = /QUESTIONS/i.test(p);
        add(drows, row('#/p/' + encodeURIComponent(id) + '/doc/' + encodeURIComponent(p), pad2(i + 1), baseName(p),
          p.split('/').slice(2, -1).join('/') || 'project', q ? 'Answer' : 'Read', q ? 'ap-status--beta' : 'ap-status--archive'));
      });
      nodes.push(add(d, drows));

      m.loose.forEach(function (group) {
        var g = section('§ ' + pad2(n++) + ' — ' + group.dir.toUpperCase());
        nodes.push(add(g, gallery(id, group, events)));
      });
      show(nodes);
    });
  }

  // ---- jobs: pick a recipe, fill in checked values; the PC runs it (one at a time) ----
  var KINDS = [['draft', 'Render a draft'], ['check', 'Check'], ['snapshot', 'Snapshot'], ['music', 'Music bed']];
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

  function fileTile(project, f, alias, events) {
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
    return Promise.all([call('manifest', { project: id }), call('text', { project: id, path: path }, 'text'), loadEvents(id)]).then(function (r) {
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

  function viewVideo(id, vid, wantDraft) {
    return Promise.all([call('manifest', { project: id }), loadEvents(id)]).then(function (both) {
      var m = both[0], events = both[1];
      var v = m.videos.filter(function (x) { return x.id === vid; })[0];
      if (!v) throw new Error('No video ' + vid);
      setCrumbs([{ text: 'Studio', href: '#/' }, { text: m.name, href: '#/p/' + encodeURIComponent(id) }, { text: v.id }]);

      var s = section('§ 01 — ' + v.id.toUpperCase());
      add(s, headline(v.title + ',', v.drafts.length + (v.drafts.length === 1 ? ' draft.' : ' drafts.')));
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
        button('st-tab', 'Request changes', function () { decide('changes'); }));
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
        location.replace('#/p/' + encodeURIComponent(id) + '/v/' + encodeURIComponent(v.id) + '/d/' + encodeURIComponent(d.label));
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
    else if (h[0] === 'p' && h[1] && h[2] === 'v' && h[3]) p = viewVideo(h[1], h[3], h[4] === 'd' ? h[5] : null);
    else if (h[0] === 'p' && h[1] && h[2] === 'doc' && h[3]) p = viewDoc(h[1], h[3]);
    else if (h[0] === 'p' && h[1]) p = viewProject(h[1]);
    else p = viewProjects();
    p.catch(function (e) {
      if (e instanceof NeedKey) return viewKey(!!getKey());
      show([add(section('§ — ERROR'), el('p', 'st-empty', e.message))]);
    });
    if (h[0] && (LOCAL || getKey())) call('projects').then(function (r) { showWorker(r.worker); }).catch(function () {});
  }

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
