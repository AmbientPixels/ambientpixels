// Vale Mail — pure core logic (no DOM, no network).
//
// Runs in the browser (window.ValeMailCore) and under node tests (module.exports).
// Everything that can be decided without the page lives here: email sanitising for the
// sandboxed reader, Reply-To phishing guard, the question Vale offers stances on, thread
// facts, buckets/counts for the filter chips, search sanitising, the send/undo state
// machine and keyboard shortcuts.
// Plan: docs/superpowers/plans/2026-10-17-vale-mail-overnight.md (Task 3).

(function (root) {
  'use strict';

  // ── Small helpers ──────────────────────────────────────────────────────────

  function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  function escapeHtml(s) {
    return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')' };
  function decodeEntities(s) {
    return str(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+[0-9]*);?/gi, function (all, e) {
      if (e[0] === '#') {
        var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!isFinite(n) || n < 0 || n > 0x10ffff) return '';
        try { return String.fromCodePoint(n); } catch (x) { return ''; }
      }
      var k = e.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED, k) ? NAMED[k] : all;
    });
  }

  function ea(r) {
    var e = (r && r.emailAddress) || r || {};
    return { name: str(e.name), address: str(e.address).trim().toLowerCase() };
  }

  function header(msg, name) {
    var hs = (msg && msg.internetMessageHeaders) || [];
    var n = name.toLowerCase();
    for (var i = 0; i < hs.length; i++) if (hs[i] && str(hs[i].name).toLowerCase() === n) return str(hs[i].value);
    return '';
  }

  function domainOf(address) { var a = str(address).toLowerCase(); var i = a.lastIndexOf('@'); return i === -1 ? '' : a.slice(i + 1); }

  function domainMatches(address, domains) {
    var d = domainOf(address);
    if (!d) return false;
    return (domains || []).some(function (x) {
      var want = str(x).trim().toLowerCase().replace(/^@/, '');
      return !!want && (d === want || d.slice(-(want.length + 1)) === '.' + want);
    });
  }

  // ── Reader sandbox document ────────────────────────────────────────────────

  // Tags removed with everything inside them.
  var DROP_WITH_CONTENT = /<(script|title|iframe|object|applet|frameset|noembed|noframes)\b[\s\S]*?<\/\1\s*>/gi;
  // Tags removed on their own (their text content, if any, stays as plain text).
  var DROP_TAGS = ['script', 'title', 'iframe', 'object', 'applet', 'frameset', 'frame', 'noembed', 'noframes',
    'embed', 'base', 'link', 'meta', 'form', 'html', 'head', 'body'];
  var DROP_TAG_RE = new RegExp('<\\/?(?:[a-z0-9-]+:)?(' + DROP_TAGS.join('|') + ')\\b(?:"[^"]*"|\'[^\']*\'|[^\'">])*>', 'gi');
  var TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  var ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  var URL_ATTRS = ['href', 'src', 'xlink:href', 'background', 'poster', 'lowsrc', 'dynsrc', 'data', 'cite', 'longdesc', 'action'];
  var DROP_ATTRS = ['ping', 'srcdoc', 'formaction', 'action', 'http-equiv'];

  function unsafeUrl(value, attr) {
    // Unknown named entities are dropped for the check, so no entity can hide a scheme.
    var v = decodeEntities(value).replace(/&[a-z]+[0-9]*;?/gi, '').replace(/[\u0000-\u0020\u007f-\u00a0]/g, '').toLowerCase();
    if (/^(javascript|vbscript|livescript|mocha):/.test(v)) return true;
    if (/^data:/.test(v)) return !(attr === 'src' && /^data:image\/(png|gif|jpe?g|webp|bmp);/.test(v));
    return false;
  }

  function normCid(s) { return str(s).trim().replace(/^<|>$/g, '').toLowerCase(); }

  function cleanTag(name, rest, inline) {
    var selfClose = /\/\s*$/.test(rest);
    var out = [];
    var m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(rest))) {
      var an = m[1].toLowerCase();
      var hasVal = m[2] !== undefined || m[3] !== undefined || m[4] !== undefined;
      var val = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
      if (/^on/.test(an) || DROP_ATTRS.indexOf(an) !== -1) continue;
      if (an === 'style' && /expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(decodeEntities(val))) continue;
      if (URL_ATTRS.indexOf(an) !== -1 && hasVal) {
        if (an === 'src' && /^\s*cid:/i.test(val) && inline) {
          var hit = inline[normCid(val.replace(/^\s*cid:/i, ''))];
          if (typeof hit === 'string' && /^data:image\//i.test(hit)) val = hit;
        }
        if (unsafeUrl(val, an)) val = '#';
      }
      out.push(hasVal ? ' ' + an + '="' + val.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"' : ' ' + an);
    }
    return '<' + name + out.join('') + (selfClose ? ' />' : '>');
  }

  function sanitizeHtml(src, inline) {
    var map = null;
    if (inline && typeof inline === 'object') {
      map = {};
      Object.keys(inline).forEach(function (k) { map[normCid(k)] = inline[k]; });
    }
    var s = str(src);
    s = s.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
    s = s.replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g, '');
    s = s.replace(/<![a-z][^>]*>/gi, '');
    s = s.replace(DROP_WITH_CONTENT, '');
    s = s.replace(DROP_TAG_RE, '');
    s = s.replace(TAG_RE, function (all, name, rest) {
      var local = name.toLowerCase().split(':').pop();
      if (DROP_TAGS.indexOf(local) !== -1) return '';
      return cleanTag(name, rest, map);
    });
    return s;
  }

  var BASE_CSS = 'html,body{margin:0;padding:0}body{padding:16px;font:14px/1.55 -apple-system,"Segoe UI",system-ui,sans-serif;' +
    'color:#1d1d1f;background:#fff;color-scheme:light;overflow-wrap:anywhere}img{max-width:100%;height:auto}' +
    'pre.vm-text{white-space:pre-wrap;font:inherit;margin:0}a{color:#5b4fd6}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:2px solid #d4d4dc;color:#555}';

  // Full HTML document for <iframe sandbox srcdoc>. Defence in depth: the sandbox (no
  // allow-scripts / allow-same-origin) and the CSP meta already stop scripts and remote
  // loads; the sanitiser also removes them so nothing depends on one layer.
  function safeBodyDoc(body, allowImages, inlineImages) {
    var b = body || {};
    var isHtml = str(b.contentType).toLowerCase() === 'html';
    var inner = isHtml ? sanitizeHtml(b.content, inlineImages) : '<pre class="vm-text">' + escapeHtml(b.content) + '</pre>';
    var csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:" + (allowImages ? ' https:' : '') + "; font-src data:; form-action 'none'";
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
      '<base target="_blank"><style>' + BASE_CSS + '</style></head><body>' + inner + '</body></html>';
  }

  function hasRemoteImages(html) {
    var s = str(html);
    if (!s) return false;
    var remote = '(?:https?:)?\\/\\/';
    return new RegExp('<img\\b(?:"[^"]*"|\'[^\']*\'|[^\'">])*?\\bsrc\\s*=\\s*["\']?\\s*' + remote, 'i').test(s) ||
      new RegExp('\\bsrcset\\s*=\\s*["\'][^"\']*' + remote, 'i').test(s) ||
      new RegExp('url\\(\\s*(?:&quot;|["\'])?\\s*' + remote, 'i').test(s) ||
      new RegExp('\\b(?:background|poster)\\s*=\\s*["\']?\\s*' + remote, 'i').test(s);
  }

  // ── Text conversion ────────────────────────────────────────────────────────

  function htmlToText(html) {
    var s = str(html);
    s = s.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
    s = s.replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table|ul|ol|pre|section|article|header|footer)\s*>/gi, '\n');
    s = s.replace(/<[^>]*>/g, '');
    s = decodeEntities(s).replace(/\u00a0/g, ' ');
    s = s.split('\n').map(function (l) { return l.replace(/[ \t\r\f\v]+/g, ' ').trim(); }).join('\n');
    return s.replace(/\n{3,}/g, '\n\n').trim();
  }

  function textToHtml(text) {
    return escapeHtml(str(text).replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
  }

  // ── Who you are really replying to ─────────────────────────────────────────

  function replyTargets(msg) {
    var rt = ((msg && msg.replyTo) || []).map(ea).filter(function (r) { return r.address; });
    if (rt.length) return rt;
    var f = ea(msg && msg.from);
    return f.address ? [f] : [];
  }

  function replyToMismatch(msg) {
    if (!msg) return null;
    var from = ea(msg.from);
    var rt = (msg.replyTo || []).map(ea).filter(function (r) { return r.address; });
    if (!rt.length) return null;
    var differs = rt.some(function (r) { return r.address !== from.address; });
    return differs ? { from: from, replyTo: rt } : null;
  }

  // ── The question Vale offers stances on ────────────────────────────────────

  var QUOTE_MARKERS = [
    /^\s*>/m,
    /^\s*On\b[^\n]{0,200}(?:\n[^\n]{0,200})?wrote:\s*$/m,
    /^\s*-{2,}\s*Original Message/im,
    /^\s*_{10,}\s*$/m,
    /^\s*From:\s+\S/m
  ];

  function newestPart(text) {
    var s = str(text).replace(/\r\n?/g, '\n');
    var cut = s.length;
    QUOTE_MARKERS.forEach(function (re) { var m = re.exec(s); if (m && m.index < cut) cut = m.index; });
    return s.slice(0, cut);
  }

  function findQuestion(text) {
    var lines = newestPart(text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split(/(?<=[.!?])\s+/);
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j].trim().replace(/^[-*\u2022]\s+/, '');
        if (p.length > 1 && p.length <= 200 && /\?$/.test(p) && /[A-Za-z]/.test(p)) return p;
      }
    }
    return null;
  }

  // ── Thread facts ───────────────────────────────────────────────────────────

  function meAddress(me) { return str(me && typeof me === 'object' ? (me.mail || me.address) : me).trim().toLowerCase(); }
  function whenOf(m) { return (m && (m.receivedDateTime || m.sentDateTime)) || null; }

  function threadStrip(threadMsgs, me) {
    var list = threadMsgs || [];
    var mine = meAddress(me);
    var latest = null, latestT = -Infinity, fromMe = 0;
    list.forEach(function (m) {
      if (mine && ea(m && m.from).address === mine) fromMe++;
      var w = whenOf(m), t = Date.parse(w || '');
      if (w && isFinite(t) && t > latestT) { latestT = t; latest = w; }
    });
    return { count: list.length, fromMe: fromMe, latestAt: latest };
  }

  var AUTOMATED = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounce[s]?)([+.-][^@]*)?@/;

  function waitingOnYou(msg, sentInThread, nowMs, opts) {
    if (!msg) return null;
    var from = ea(msg.from).address;
    if (!from || AUTOMATED.test(from)) return null;
    var own = str(opts && opts.ownDomain).toLowerCase();
    if (own && domainMatches(from, [own])) return null;
    if (header(msg, 'list-unsubscribe')) return null;
    var got = Date.parse(msg.receivedDateTime || '');
    if (!isFinite(got) || nowMs - got <= 86400000) return null;
    var answered = (sentInThread || []).some(function (s) { var t = Date.parse((s && s.sentDateTime) || ''); return isFinite(t) && t > got; });
    return answered ? null : { since: msg.receivedDateTime };
  }

  // ── Buckets for the filter chips ───────────────────────────────────────────

  var LABEL_BUCKET = { needs_you: 'needs_you', waiting: 'waiting', noise: 'newsletter', newsletter: 'newsletter', fyi: 'set_aside', receipt: 'set_aside' };

  function bucketOf(msg, label) {
    var l = label && typeof label === 'object' ? label.label : label;
    if (msg && msg.flag && msg.flag.flagStatus === 'flagged') return 'needs_you';
    if (header(msg, 'list-unsubscribe')) return 'newsletter';
    return Object.prototype.hasOwnProperty.call(LABEL_BUCKET, l) ? LABEL_BUCKET[l] : 'other';
  }

  function counts(msgs, labels) {
    var out = { needs_you: 0, waiting: 0, newsletter: 0, set_aside: 0, all: 0 };
    var map = labels || {};
    (msgs || []).forEach(function (m) {
      out.all++;
      var b = bucketOf(m, map[m && m.id]);
      if (b !== 'other') out[b]++;
    });
    return out;
  }

  function isClientMsg(msg, domains) {
    if (!msg || !domains || !domains.length) return false;
    var people = [msg.from].concat(msg.toRecipients || [], msg.ccRecipients || []);
    return people.some(function (p) { return domainMatches(ea(p).address, domains); });
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  function searchQuery(input) {
    if (typeof input !== 'string') return null;
    var s = input.replace(/[^A-Za-z0-9@._\- "]/g, ' ');
    if ((s.match(/"/g) || []).length % 2) s = s.replace(/"/g, ' ');
    s = s.replace(/\s+/g, ' ').trim().slice(0, 80).trim();
    return s ? s : null;
  }

  // ── Send / undo state machine ──────────────────────────────────────────────
  // Never a half-sent state: Undo is only possible during the countdown, and a failed
  // send goes back to an editable draft.

  var TRANSITIONS = {
    idle: { draft: 'drafting', edit: 'ready' },
    drafting: { drafted: 'ready', draftFailed: 'idle' },
    ready: { send: 'countdown', draft: 'drafting', discard: 'idle', edit: 'ready' },
    countdown: { undo: 'undone', elapse: 'sending' },
    undone: { edit: 'ready', discard: 'idle' },
    sending: { sent: 'sent', fail: 'failed' },
    failed: { edit: 'ready' },
    sent: { reset: 'idle' }
  };

  function sendMachine() {
    var state = 'idle';
    var api = {
      can: function (action) { return Object.prototype.hasOwnProperty.call(TRANSITIONS[state], action); },
      next: function (action) {
        if (!api.can(action)) throw new Error('bad_transition: ' + action + ' from ' + state);
        state = TRANSITIONS[state][action];
        return state;
      }
    };
    Object.defineProperty(api, 'state', { get: function () { return state; }, enumerable: true });
    return api;
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  var KEYS = { j: 'next', k: 'prev', Enter: 'open', e: 'archive', r: 'reply', d: 'draft', f: 'flag', u: 'unread', '/': 'search', '?': 'help', Escape: 'close', Esc: 'close' };

  function shortcutFor(event) {
    if (!event || typeof event.key !== 'string') return null;
    if (event.ctrlKey || event.metaKey || event.altKey) return null;
    var t = event.target || {};
    var tag = str(t.tagName).toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return null;
    return Object.prototype.hasOwnProperty.call(KEYS, event.key) ? KEYS[event.key] : null;
  }

  var _exports = {
    safeBodyDoc: safeBodyDoc, hasRemoteImages: hasRemoteImages, htmlToText: htmlToText, textToHtml: textToHtml,
    replyTargets: replyTargets, replyToMismatch: replyToMismatch, findQuestion: findQuestion,
    threadStrip: threadStrip, waitingOnYou: waitingOnYou, bucketOf: bucketOf, counts: counts,
    isClientMsg: isClientMsg, searchQuery: searchQuery, sendMachine: sendMachine, shortcutFor: shortcutFor,
    escapeHtml: escapeHtml
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
  else if (root) root.ValeMailCore = _exports;
})(typeof window !== 'undefined' ? window : this);
