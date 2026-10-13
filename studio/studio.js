/* AmbientPixels Studio: the front end for the AI video pipeline.
   Plan: ai-video-pipeline/docs/plans/2026-10-12-studio-harness-plan.md
   One UI, two backends: on this PC (localhost, served by harness/server.mjs) it talks to the local API, which
   reads the project folders directly; anywhere else it talks to the Function App, which serves what the PC's
   worker uploaded. The API base is an allowlist: only a local host gets the relative path. */
(function () {
  'use strict';

  var LOCAL = ['localhost', '127.0.0.1'].indexOf(location.hostname) !== -1;
  var API = LOCAL ? '/api/studio' : 'https://ambientpixels-nova-api.azurewebsites.net/api/studio';
  var KEY_NAME = 'ap_studio_key'; // the credential only; no data is ever cached in the browser

  var app = document.getElementById('app');
  var crumbs = document.getElementById('crumbs');
  var workerEl = document.getElementById('worker');

  function getKey() { try { return localStorage.getItem(KEY_NAME) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { k ? localStorage.setItem(KEY_NAME, k) : localStorage.removeItem(KEY_NAME); } catch (e) {} }

  function NeedKey() {}

  function call(action, query, as) {
    var url = API + '/' + action + (query ? '?' + new URLSearchParams(query) : '');
    var headers = LOCAL ? {} : { 'x-studio-key': getKey() };
    return fetch(url, { headers: headers, cache: 'no-store' }).then(function (res) {
      if (res.status === 403) throw new NeedKey();
      if (!res.ok) return res.json().catch(function () { return {}; }).then(function (b) {
        var err = new Error(b.error || ('HTTP ' + res.status)); err.status = res.status; throw err;
      });
      return as === 'text' ? res.text() : res.json();
    });
  }

  // ---- tiny DOM helpers (text only: nothing from a manifest is ever parsed as HTML) ----
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function headline(text, punch) { var h = el('h1', 'ap-display st-h', text + ' '); add(h, el('em', null, punch)); return h; }
  function section(idx) { return add(el('section', 'st-sec'), el('div', 'ap-sec-idx', idx)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function when(iso) {
    if (!iso) return 'never';
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
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
      show([add(s, rows)]);
    });
  }

  function viewProject(id) {
    return call('manifest', { project: id }).then(function (m) {
      setCrumbs([{ text: 'Studio', href: '#/' }, { text: m.name }]);
      var nodes = [];
      var s = section('§ 01 — ' + m.name.toUpperCase());
      add(s, headline(m.videos.length + (m.videos.length === 1 ? ' video,' : ' videos,'), 'every draft.'));
      var rows = el('div', 'st-rows');
      m.videos.forEach(function (v, i) {
        var latest = v.drafts[0];
        var meta = v.id + ' · ' + v.drafts.length + ' drafts' + (latest ? ' · latest ' + latest.label + ', ' + when(latest.mtime) : '');
        add(rows, row('#/p/' + encodeURIComponent(id) + '/v/' + encodeURIComponent(v.id), pad2(i + 1), v.title, meta,
          latest ? latest.label : 'No render', latest ? '' : 'ap-status--archive'));
      });
      if (!m.videos.length) add(rows, el('p', 'st-empty', 'No compositions in series/ yet.'));
      nodes.push(add(s, rows));

      m.loose.forEach(function (group, gi) {
        var g = section('§ ' + pad2(gi + 2) + ' — ' + group.dir.toUpperCase());
        var gal = el('div', 'st-gallery');
        group.files.forEach(function (f) { gal.appendChild(fileTile(id, f)); });
        nodes.push(add(g, gal));
      });
      show(nodes);
    });
  }

  // One loose file: images and audio play inline (from a short-lived link), anything else is named.
  function fileTile(project, f) {
    var fig = el('figure');
    var name = f.path.slice(f.path.lastIndexOf('/') + 1);
    var ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    var cap = el('figcaption', 'st-note', name + (f.cloud === false ? ' · on the PC only' : ''));
    if (f.cloud === false) return add(fig, cap);
    if (['png', 'jpg', 'webp'].indexOf(ext) !== -1 || ['mp3', 'wav'].indexOf(ext) !== -1) {
      call('media', { project: project, path: f.path }).then(function (r) {
        var media = ext === 'mp3' || ext === 'wav' ? el('audio') : el('img');
        media.src = r.url;
        if (media.tagName === 'AUDIO') media.controls = true; else media.alt = name;
        fig.insertBefore(media, cap);
      }).catch(function () { cap.textContent = name + ' · not uploaded yet'; });
    }
    return add(fig, cap);
  }

  function viewVideo(id, vid) {
    return call('manifest', { project: id }).then(function (m) {
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
      var pmeta = el('div', 'st-player-meta');
      var label = el('span', 'st-note', 'Pick a draft.');
      var link = el('span', 'st-note');
      add(pmeta, label, link);
      var qc = el('pre', 'st-pre');
      add(player, video, pmeta, qc);

      var list = el('div', 'st-drafts');
      var buttons = [];
      v.drafts.forEach(function (d) {
        var file = d.files.master || d.files.raw;
        var b = el('button', 'st-draft');
        b.type = 'button';
        var where = !file ? 'no video' : file.cloud === false ? 'PC only' : d.files.master ? 'master' : 'raw';
        add(b, el('b', null, d.label), el('span', 'st-note', where), el('span', 'st-note', when(d.mtime)), el('span', 'st-note', d.dir.split('/').slice(2).join('/') || ''));
        if (!file || file.cloud === false) b.disabled = true;
        b.addEventListener('click', function () { play(d); });
        buttons.push(b);
        list.appendChild(b);
      });

      function play(d) {
        buttons.forEach(function (b, i) { b.setAttribute('aria-current', v.drafts[i] === d ? 'true' : 'false'); });
        var file = d.files.master || d.files.raw;
        label.textContent = d.label + (d.files.master ? ' · mastered' : ' · raw render');
        link.textContent = '';
        qc.textContent = '';
        Array.prototype.slice.call(video.querySelectorAll('track')).forEach(function (t) { t.remove(); });
        call('media', { project: id, path: file.path }).then(function (r) { video.src = r.url; });
        // Captions come through the text endpoint and play from a blob: URL, so they need no cross-origin setup.
        if (d.files.vtt && d.files.vtt.cloud !== false) {
          call('text', { project: id, path: d.files.vtt.path }, 'text').then(function (vtt) {
            var t = el('track');
            t.kind = 'captions'; t.label = 'English'; t.srclang = 'en'; t.default = true;
            t.src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
            video.appendChild(t);
          }).catch(function () {});
        }
        if (d.files.qc && d.files.qc.cloud !== false) {
          call('text', { project: id, path: d.files.qc.path }, 'text').then(function (t) { qc.textContent = t; }).catch(function () {});
        }
      }

      add(grid, player, list);
      show([add(s, grid)]);
      var first = v.drafts.filter(function (d) { var f = d.files.master || d.files.raw; return f && f.cloud !== false; })[0];
      if (first) play(first);
    });
  }

  // ---- router ----
  function route() {
    var h = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    var p = h[0] === 'p' && h[1] ? (h[2] === 'v' && h[3] ? viewVideo(h[1], h[3]) : viewProject(h[1])) : viewProjects();
    p.catch(function (e) {
      if (e instanceof NeedKey) return viewKey(!!getKey());
      show([add(section('§ — ERROR'), el('p', 'st-empty', e.message))]);
    });
    if (!(h[0] === '' || h[0] === undefined)) call('projects').then(function (r) { showWorker(r.worker); }).catch(function () {});
  }

  if (!LOCAL && !getKey()) viewKey(false); else route();
  window.addEventListener('hashchange', route);
})();
