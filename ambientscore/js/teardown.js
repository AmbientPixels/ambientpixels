// teardown.js — Conversion Teardown viewer ($199 done-for-you document)
// Loads the teardown via HMAC-keyed link. Pre-delivery the only person holding
// the link is the CEO, so a draft_ready document shows the Deliver button.

(function () {
  'use strict';

  // Direct to the Function App on prod — the SWA same-origin /api proxy
  // 404s GETs to index.html and 405s POSTs (long-standing; all AS frontends
  // route around it the same way).
  var API = window.location.hostname === 'localhost'
    ? '/api'
    : 'https://ambientpixels-nova-api.azurewebsites.net/api';

  var params = new URLSearchParams(window.location.search);
  var orderId = params.get('id');
  var key = params.get('key');

  var loadingEl = document.getElementById('as-td-loading');
  var contentEl = document.getElementById('as-td-content');

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showError(msg) {
    loadingEl.hidden = true;
    contentEl.hidden = false;
    contentEl.innerHTML =
      '<section class="as-td-doc"><div class="as-eyebrow">Access</div>' +
      '<h1>Document <em>unavailable.</em></h1>' +
      '<p class="as-td-lede">' + escapeHtml(msg) + '</p></section>';
  }

  function killerCard(k, i) {
    var code = 'K-0' + (i + 1);
    return '<article class="as-td-killer">' +
      '<div class="as-td-killer-head">' +
      '<span class="as-td-killer-code">' + code + '</span>' +
      '<h3>' + escapeHtml(k.title) + '</h3>' +
      '<span class="as-td-impact as-td-impact-' + escapeHtml((k.impact || 'medium').toLowerCase()) + '">' + escapeHtml((k.impact || 'medium').toUpperCase()) + '</span>' +
      '</div>' +
      '<p class="as-td-killer-why">' + escapeHtml(k.why) + '</p>' +
      '<div class="as-td-rewrite">' +
      '<div class="as-td-before"><div class="as-td-rw-label">Before</div><p>' + escapeHtml(k.before) + '</p></div>' +
      '<div class="as-td-after"><div class="as-td-rw-label">After</div><p>' + escapeHtml(k.after) + '</p></div>' +
      '</div>' +
      '</article>';
  }

  function render(doc) {
    var t = doc.teardown || {};
    var html = '';

    html += '<section class="as-td-doc">';
    html += '<div class="as-eyebrow">Conversion Teardown . Form TD-1' + (doc.status === 'draft_ready' ? ' . DRAFT' : '') + '</div>';
    html += '<h1>' + escapeHtml(doc.url) + '</h1>';
    html += '<div class="as-td-scoreline"><span class="as-td-score">' + (doc.score != null ? doc.score : '?') + '<sub>/100</sub></span>';
    html += '<span class="as-td-meta">' + escapeHtml(doc.siteType || '') + (doc.goal ? ' . Goal: ' + escapeHtml(doc.goal) : '') + '</span></div>';

    if (t.summary) {
      html += '<div class="as-td-summary"><div class="as-td-sec-label">Summary</div><p>' + escapeHtml(t.summary) + '</p></div>';
    }

    html += '<div class="as-td-sec-label">The five conversion killers</div>';
    (t.killers || []).forEach(function (k, i) { html += killerCard(k, i); });

    if (Array.isArray(t.fixOrder) && t.fixOrder.length) {
      html += '<div class="as-td-sec-label">Your four week fix order</div>';
      html += '<table class="as-td-fixtable"><tbody>';
      t.fixOrder.forEach(function (w) {
        html += '<tr><td class="as-td-week">Week ' + escapeHtml(String(w.week)) + '</td><td><ul>';
        (w.items || []).forEach(function (item) { html += '<li>' + escapeHtml(item) + '</li>'; });
        html += '</ul></td></tr>';
      });
      html += '</tbody></table>';
    }

    html += '<div class="as-td-sig"><span class="as-td-caret">&rsaquo;</span> Reviewed by a strategist. The AmbientScore Desk.</div>';

    if (doc.status === 'draft_ready') {
      html += '<div class="as-td-deliver">';
      html += '<div class="as-td-sec-label">Review complete?</div>';
      html += '<button type="button" class="as-buy-btn" id="as-td-deliver-btn">Deliver to client' + (doc.email ? ' . ' + escapeHtml(doc.email) : '') + '</button>';
      html += '<div id="as-td-deliver-status" class="as-td-status"></div>';
      html += '</div>';
    }

    html += '</section>';

    loadingEl.hidden = true;
    contentEl.hidden = false;
    contentEl.innerHTML = html;

    var deliverBtn = document.getElementById('as-td-deliver-btn');
    if (deliverBtn) {
      deliverBtn.addEventListener('click', function () {
        deliverBtn.disabled = true;
        deliverBtn.textContent = 'Delivering.';
        fetch(API + '/as-teardown', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'deliver', id: orderId, key: key })
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
          .then(function (res) {
            var statusEl = document.getElementById('as-td-deliver-status');
            if (res.ok && res.data.delivered) {
              statusEl.textContent = 'Delivered. The client has the document.';
              deliverBtn.textContent = 'Delivered';
            } else {
              statusEl.textContent = res.data.error || 'Delivery failed. Try again.';
              deliverBtn.disabled = false;
              deliverBtn.textContent = 'Deliver to client';
            }
          })
          .catch(function () {
            document.getElementById('as-td-deliver-status').textContent = 'Network error. Try again.';
            deliverBtn.disabled = false;
            deliverBtn.textContent = 'Deliver to client';
          });
      });
    }
  }

  if (!orderId || !key) {
    showError('This link is missing its access key. Use the exact link from your delivery email.');
    return;
  }

  fetch(API + '/as-teardown?id=' + encodeURIComponent(orderId) + '&key=' + encodeURIComponent(key))
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      if (!res.ok) {
        showError(res.data.error || 'This teardown could not be loaded.');
        return;
      }
      render(res.data);
    })
    .catch(function () {
      showError('Network error. Refresh to try again.');
    });
})();
