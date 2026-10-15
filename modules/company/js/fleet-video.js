// fleet-video.js — the Video department on the HQ Fleet page, beside the agents.
// The department is the Studio crew (human-run, not in the heartbeat). Agents suggest videos as tasks on the company
// board assigned to 'studio'; Chad decides there; the crew makes them in the Studio and reports in the task thread.
// Data: GET /api/video-department (read-only). Spec: docs/superpowers/specs/2026-10-14-video-desk-design.md §9.
(function () {
  'use strict';
  var API = (location.hostname.indexOf('ambientpixels.ai') !== -1) ? 'https://ambientpixels-nova-api.azurewebsites.net/api' : '/api';
  var SECRET = (window.AP_SECRET || 'pixelpusher');
  var BOARD = '/modules/company/tasks.html?task=';
  var STUDIO = 'https://www.ambientpixels.ai/studio/';
  var STATUS = { waiting: 'Waiting for you', accepted: 'Accepted', scripting: 'Script', in_production: 'In production', review: 'Review', released: 'Released', declined: 'Declined' };

  var root = document.getElementById('fl-video');
  var count = document.getElementById('fl-video-count');
  if (!root) return;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function day(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function label(list, id) { var x = (list || []).filter(function (f) { return f.id === id; })[0]; return x ? x.name : id; }

  function crewHtml(crew) {
    if (!crew.length) return '<div class="fl-empty">The crew list is missing from the video catalogue.</div>';
    return '<div class="fl-vd-crew">' + crew.map(function (r) {
      return '<div class="fl-vd-role' + (r.head ? ' fl-vd-role--head' : '') + '">' +
        '<div class="fl-vd-role-name">' + esc(r.name) + (r.head ? ' <span class="fl-vd-tag">Head</span>' : '') + '</div>' +
        '<div class="fl-vd-role-job">' + esc(r.mandate) + '</div></div>';
    }).join('') + '</div>';
  }

  function requestsHtml(d) {
    if (!d.requests.length) {
      return '<div class="fl-empty">No video requests yet. Nova, Echo and Scout suggest one only when a major release, a winning bet or a new campaign gives them a reason.</div>';
    }
    return d.requests.slice(0, 8).map(function (r) {
      var said = r.reason ? 'Chad: “' + r.reason + '”'
        : r.last ? (r.last.who === 'studio' ? 'Studio' : r.last.who === 'ceo' ? 'Chad' : r.last.who) + ': ' + String(r.last.text || '').replace(/^\[studio:[^\]]*\]\s*/, '') : '';
      return '<a class="fl-vd-req" href="' + BOARD + encodeURIComponent(r.taskId) + '">' +
        '<span class="fl-vd-status fl-vd-status--' + esc(r.status) + '">' + esc(STATUS[r.status] || r.status) + '</span>' +
        '<span class="fl-vd-req-main"><span class="fl-vd-req-title">' + esc(r.title) + '</span>' +
        '<span class="fl-vd-meta">' + esc([r.from, r.product, label(d.formats, r.format), day(r.createdAt)].filter(Boolean).join(' · ')) + '</span>' +
        (said ? '<span class="fl-vd-said">' + esc(said.slice(0, 160)) + '</span>' : '') + '</span></a>';
    }).join('');
  }

  function shippedHtml(d) {
    var html = '<div class="fl-vd-sub">What shipped</div>';
    if (d.lastRun) html += '<div class="fl-vd-meta">Release Watcher, last check ' + esc(day(d.lastRun.at)) + ': ' + esc(d.lastRun.commits) + ' commits, ' + esc(d.lastRun.added) + ' new</div>';
    // Hide corrects a wrong entry: a hidden release never shows to agents and can't start a video.
    html += d.releases.length ? d.releases.slice(0, 5).map(function (e) {
      return '<div class="fl-vd-rel"><span class="fl-vd-rel-sig' + (e.significance === 'major' ? ' fl-vd-rel-sig--major' : '') + '">' + esc(e.significance) + '</span> ' +
        esc(e.product + ': ' + e.title) + ' <span class="fl-vd-meta">' + esc(day(e.at)) + '</span>' +
        '<button type="button" class="fl-vd-hide" data-release="' + esc(e.id) + '" title="Hide a wrong entry">Hide</button></div>';
    }).join('') : '<div class="fl-vd-meta">No product releases in the log yet.</div>';

    var dm = d.demand || {};
    html += '<div class="fl-vd-sub">Demand</div>';
    if (!dm.requests) return html + '<div class="fl-vd-meta">Nothing asked for yet.</div>';
    var formats = Object.keys(dm.formats || {}).sort(function (a, b) { return dm.formats[b].asked - dm.formats[a].asked; }).slice(0, 4);
    html += formats.map(function (k) {
      var x = dm.formats[k];
      return '<div class="fl-vd-dem"><span>' + esc(label(d.formats, k)) + '</span><span class="fl-vd-meta">' + x.asked + ' asked · ' + x.accepted + ' taken · ' + x.released + ' shipped</span></div>';
    }).join('');
    if (dm.wishes && dm.wishes.length) html += '<div class="fl-vd-meta">Wished for: ' + esc(dm.wishes.slice(0, 3).map(function (w) { return w.what.replace(/^[a-z]+:/, '') + ' ×' + w.n; }).join(', ')) + '</div>';
    return html;
  }

  root.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.fl-vd-hide');
    if (!btn) return;
    btn.disabled = true;
    fetch(API + '/release-watch?action=status', { method: 'POST', headers: { 'x-company-secret': SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: btn.getAttribute('data-release'), status: 'hidden', by: 'ceo' }) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); btn.closest('.fl-vd-rel').remove(); })
      .catch(function () { btn.disabled = false; btn.textContent = 'Retry'; });
  });

  fetch(API + '/video-department', { headers: { 'x-company-secret': SECRET } })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) {
      var waiting = d.requests.filter(function (r) { return r.status === 'waiting'; }).length;
      if (count) count.textContent = d.open ? d.open + ' open' + (waiting ? ' · ' + waiting + ' waiting for you' : '') : '';
      root.innerHTML =
        '<div class="fl-vd-intro">The Studio crew, human-run on Chad\'s PC: not part of the heartbeat. Nova, Echo and Scout suggest videos as tasks on the board (assigned to <b>studio</b>); you accept (in-progress) or decline (cancel with a comment) there, and the crew talks to the fleet in that task\'s thread. ' +
        '<a href="' + STUDIO + '" target="_blank" rel="noopener">Open the Studio →</a></div>' +
        '<div class="fl-vd-grid">' +
          '<div class="fl-vd-col"><div class="fl-vd-sub">Crew</div>' + crewHtml(d.crew || []) + '</div>' +
          '<div class="fl-vd-col"><div class="fl-vd-sub">Requests</div>' + requestsHtml(d) + '</div>' +
          '<div class="fl-vd-col">' + shippedHtml(d) + '</div>' +
        '</div>';
    })
    .catch(function (err) {
      root.innerHTML = '<div class="fl-empty">The Video department could not be loaded (' + esc(err.message) + ').</div>';
    });
})();
