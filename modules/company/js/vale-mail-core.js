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
  // SVG animation elements are dropped too: <animate>/<set> can rewrite an href after sanitising.
  var DROP_TAGS = ['script', 'title', 'iframe', 'object', 'applet', 'frameset', 'frame', 'noembed', 'noframes',
    'embed', 'base', 'link', 'meta', 'form', 'html', 'head', 'body',
    'animate', 'animatemotion', 'animatetransform', 'set', 'discard', 'handler', 'foreignobject'];
  var DROP_TAG_RE = new RegExp('<\\/?(?:[a-z0-9-]+:)?(' + DROP_TAGS.join('|') + ')\\b(?:"[^"]*"|\'[^\']*\'|[^\'">])*>', 'gi');
  var TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  var ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  var URL_ATTRS = ['href', 'src', 'xlink:href', 'background', 'poster', 'lowsrc', 'dynsrc', 'data', 'cite', 'longdesc', 'action'];
  var LINK_ATTRS = ['href', 'xlink:href', 'action'];
  var DROP_ATTRS = ['ping', 'srcdoc', 'formaction', 'action', 'http-equiv'];

  function unsafeUrl(value, attr) {
    var v = urlForCheck(value);
    // Links: allow-list. Anything else (ms-msdt:, search-ms:, file:, smb:, relative paths that
    // would resolve against this site...) is removed, so no click can reach an OS protocol handler.
    if (LINK_ATTRS.indexOf(attr) !== -1) return !(/^(https?|mailto|tel):/.test(v) || /^#./.test(v));
    if (/^(javascript|vbscript|livescript|mocha):/.test(v)) return true;
    if (/^data:/.test(v)) return !(attr === 'src' && /^data:image\/(png|gif|jpe?g|webp|bmp);/.test(v));
    return false;
  }

  function urlForCheck(value) {
    // Unknown named entities are dropped for the check, so no entity can hide a scheme.
    return decodeEntities(value).replace(/&[a-z]+[0-9]*;?/gi, '').replace(/[\u0000-\u0020\u007f-\u00a0]/g, '').toLowerCase();
  }

  function normCid(s) { return str(s).trim().replace(/^<|>$/g, '').toLowerCase(); }

  function cleanTag(name, rest, inline) {
    var selfClose = /\/\s*$/.test(rest);
    var isLink = /^(?:[a-z0-9-]+:)?(a|area)$/i.test(name);
    var out = [];
    var m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(rest))) {
      var an = m[1].toLowerCase();
      var hasVal = m[2] !== undefined || m[3] !== undefined || m[4] !== undefined;
      var val = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
      if (/^on/.test(an) || DROP_ATTRS.indexOf(an) !== -1) continue;
      if (isLink && an === 'rel') continue;
      if (an === 'style' && /expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(decodeEntities(val))) continue;
      if (URL_ATTRS.indexOf(an) !== -1) {
        if (!hasVal) continue;
        if (an === 'src' && /^\s*cid:/i.test(val) && inline) {
          var hit = inline[normCid(val.replace(/^\s*cid:/i, ''))];
          if (typeof hit === 'string' && /^data:image\//i.test(hit)) val = hit;
        }
        // Unsafe URLs are removed outright (never rewritten to "#", which would open this page).
        if (unsafeUrl(val, an)) continue;
      }
      out.push(hasVal ? ' ' + an + '="' + val.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"' : ' ' + an);
    }
    if (isLink) out.push(' rel="noopener noreferrer"');
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

  var REMOTE_URL = /^\s*(?:https?:)?\/\//i;
  // A CSS target that leaves the email: scheme-relative "//host" or any "scheme://host".
  function remoteTarget(t) { return /^\s*["']?\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(str(t)); }

  // CSS escapes (\72, \000072 , \() decoded the way the browser does; leftover backslashes are
  // dropped so nothing can be re-escaped into a URL after this.
  function cssDecode(s) {
    return str(s).replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?/gi, function (all, hex) {
      var n = parseInt(hex, 16);
      if (!n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return String.fromCharCode(0xfffd);
      return String.fromCodePoint(n);
    }).replace(/\\([^\n\r\f0-9a-f])/gi, '$1').replace(/\\/g, '');
  }

  // Rewrites decoded CSS so no remote url(), image-set() or @import survives. Returns null when
  // nothing remote was found (the caller then keeps the original text untouched).
  function cssWithoutRemote(decoded) {
    var hit = false;
    var out = decoded.replace(/@import\b[^;]*;?/gi, function (all) { if (/\/\//.test(all)) { hit = true; return ''; } return all; })
      .replace(/url\(([^)]*)\)/gi, function (all, inner) { if (remoteTarget(inner)) { hit = true; return 'none'; } return all; })
      .replace(/(?:-webkit-)?image-set\(((?:[^()]|\([^()]*\))*)\)/gi, function (all, inner) {
        if (/["']\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(inner)) { hit = true; return 'none'; }
        return all;
      });
    return hit ? out : null;
  }

  // Runs on sanitizeHtml output, where every attribute value is double-quoted.
  function stripRemoteImages(s) {
    return str(s)
      // <style> blocks: raw text (no HTML entities), CSS escapes only. '<' is re-escaped so a
      // decoded "\3c /style\3e" can never close the block.
      .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, function (all, open, css, close) {
        var clean = cssWithoutRemote(cssDecode(css));
        return clean === null ? all : open + clean.replace(/</g, '\\3c ') + close;
      })
      // style="" attributes: HTML entities first, then CSS escapes, as the browser does.
      .replace(/\sstyle="([^"]*)"/gi, function (all, v) {
        var clean = cssWithoutRemote(cssDecode(decodeEntities(v)));
        return clean === null ? all : ' style="' + escapeHtml(clean) + '"';
      })
      .replace(/\s(src|background|poster|lowsrc|dynsrc)="([^"]*)"/gi, function (all, a, v) { return REMOTE_URL.test(decodeEntities(v)) ? '' : all; })
      .replace(/\ssrcset="([^"]*)"/gi, function (all, v) { return /\/\//.test(decodeEntities(v)) ? '' : all; })
      // SVG images: <image>, <feImage> and <use> fetch their href.
      .replace(/<((?:[a-z0-9-]+:)?(?:image|feimage|use))\b([^>]*)>/gi, function (all, name, rest) {
        var kept = rest.replace(/\s(?:xlink:)?href="([^"]*)"/gi, function (a, v) { return REMOTE_URL.test(decodeEntities(v)) ? '' : a; });
        return kept === rest ? all : '<' + name + kept + '>';
      })
      .replace(/url\(\s*(?:&quot;|&#39;|["'])?\s*(?:https?:)?\/\/[^)]*\)/gi, 'none');
  }

  var BASE_CSS ='html,body{margin:0;padding:0}body{padding:16px;font:14px/1.55 -apple-system,"Segoe UI",system-ui,sans-serif;' +
    'color:#1d1d1f;background:#fff;color-scheme:light;overflow-wrap:anywhere}img{max-width:100%;height:auto}' +
    'pre.vm-text{white-space:pre-wrap;font:inherit;margin:0}a{color:#5b4fd6}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:2px solid #d4d4dc;color:#555}';

  // Full HTML document for <iframe sandbox srcdoc>. Defence in depth: the sandbox (no
  // allow-scripts / allow-same-origin) and the CSP meta already stop scripts and remote
  // loads; the sanitiser also removes them so nothing depends on one layer.
  function safeBodyDoc(body, allowImages, inlineImages) {
    var b = body || {};
    var isHtml = str(b.contentType).toLowerCase() === 'html';
    var inner = isHtml ? sanitizeHtml(b.content, inlineImages) : '<pre class="vm-text">' + escapeHtml(b.content) + '</pre>';
    // Images hidden: remove remote image URLs outright, so nothing is even requested
    // (tracking pixels never fire) and nothing depends on the CSP alone.
    if (isHtml && !allowImages) inner = stripRemoteImages(inner);
    var csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:" + (allowImages ? ' https:' : '') + "; font-src data:; form-action 'none'";
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
      '<base target="_blank"><style>' + BASE_CSS + '</style></head><body>' + inner + '</body></html>';
  }

  // Same detector as the stripper: true exactly when hiding images would remove something.
  function hasRemoteImages(html) {
    var s = str(html);
    if (!s) return false;
    var clean = sanitizeHtml(s);
    return stripRemoteImages(clean) !== clean;
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

  // subject (optional): when the newest body part asks nothing, a subject that is itself a
  // question ("Did Marcus reach you?", "RE: Saturday?") is the question.
  function findQuestion(text, subject) {
    var lines = newestPart(text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split(/(?<=[.!?])\s+/);
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j].trim().replace(/^[-*\u2022]\s+/, '');
        if (p.length > 1 && p.length <= 200 && /\?$/.test(p) && /[A-Za-z]/.test(p)) return p;
      }
    }
    var s = str(subject).trim();
    var prev;
    do { prev = s; s = s.replace(/^(?:re|fwd?|aw|sv)\s*:\s*/i, '').trim(); } while (s !== prev);
    if (s.length > 1 && s.length <= 200 && /\?$/.test(s) && /[A-Za-z]/.test(s)) return s;
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
    var people = [msg.from].concat(msg.toRecipients || [], msg.ccRecipients || [], msg.replyTo || []);
    return people.some(function (p) { return domainMatches(ea(p).address, domains); });
  }

  // A thread is client mail when ANY message in it involves a client (from, to, cc, reply-to).
  function threadIsClient(msgs, domains) {
    return (msgs || []).some(function (m) { return isClientMsg(m, domains); });
  }

  // HTML that is only text structure (no attributes, links, images, tables or styles) reads
  // better as plain text on the app's own surface than inside a white iframe.
  var SIMPLE_TAGS = ['div', 'p', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 'blockquote', 'ul', 'ol', 'li'];
  function isSimpleHtml(html) {
    var s = str(html);
    if (!s.trim()) return true;
    var tags = s.match(/<\/?[^>]*>/g) || [];
    return tags.every(function (t) {
      var m = /^<\/?\s*([a-z0-9]+)\s*\/?>$/i.exec(t);
      return !!m && SIMPLE_TAGS.indexOf(m[1].toLowerCase()) !== -1;
    });
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

  // ── UI helpers (Task 5): dates, sizes, names, drafts, clashes, errors ───────

  var DEFAULT_TZ = 'America/Los_Angeles';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Calendar-date parts of an instant in a time zone (undefined tz = the runtime's local zone).
  function zoned(ms, tz) {
    var o = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' };
    if (tz) o.timeZone = tz;
    var parts = {};
    try { new Intl.DateTimeFormat('en-US', o).formatToParts(new Date(ms)).forEach(function (p) { parts[p.type] = p.value; }); }
    catch (e) { return null; }
    return {
      y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
      h: Number(parts.hour) % 24, min: Number(parts.minute), wd: WEEKDAYS.indexOf(parts.weekday)
    };
  }
  function dayNum(z) { return Date.UTC(z.y, z.m - 1, z.d) / 86400000; }

  function clock(z) {
    var h12 = z.h % 12 === 0 ? 12 : z.h % 12;
    return h12 + ':' + (z.min < 10 ? '0' : '') + z.min + ' ' + (z.h < 12 ? 'AM' : 'PM');
  }

  // List timestamp: "2:48 PM" today, "Yesterday", weekday within the week, "Aug 2", "Dec 30, 2025".
  function formatWhen(iso, nowMs, opts) {
    var t = Date.parse(str(iso));
    if (!isFinite(t)) return '';
    var tz = opts && opts.timeZone;
    var z = zoned(t, tz), n = zoned(isFinite(nowMs) ? nowMs : Date.now(), tz);
    if (!z || !n) return '';
    var diff = dayNum(n) - dayNum(z);
    if (diff <= 0) return clock(z);
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return WEEKDAYS[z.wd];
    return MONTHS[z.m - 1] + ' ' + z.d + (z.y !== n.y ? ', ' + z.y : '');
  }

  function formatTime(ms, opts) { var z = zoned(ms, opts && opts.timeZone); return z ? clock(z) : ''; }

  // Relative time that agrees with formatWhen: days are calendar days in opts.timeZone (default:
  // the runtime's zone), so a Thursday message seen on Saturday is "2 days ago", never "yesterday".
  function agoText(iso, nowMs, opts) {
    var t = Date.parse(str(iso));
    if (!isFinite(t)) return '';
    var s = Math.max(0, (nowMs - t) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    var tz = opts && opts.timeZone;
    var z = zoned(t, tz), n = zoned(nowMs, tz);
    var d = z && n ? dayNum(n) - dayNum(z) : Math.floor(m / 1440);
    if (d <= 0) { var h = Math.floor(m / 60); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
    if (d === 1) return 'yesterday';
    if (d < 14) return d + ' days ago';
    var w = Math.floor(d / 7);
    if (d < 60) return w + ' weeks ago';
    return Math.floor(d / 30) + ' months ago';
  }

  function formatSize(bytes) {
    var n = Number(bytes);
    if (typeof bytes !== 'number' || !isFinite(n) || n < 0) return '';
    if (n < 1024) return Math.round(n) + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (Math.round(n / 1024 / 1024 * 10) / 10) + ' MB';
  }

  var ROLE_LOCAL = /^(newsletters?|no-?reply|do-?not-?reply|hello|team|info|support|notifications?|billing|news|updates|marketing|mailer-daemon)([+.-][^@]*)?$/;

  // The name to greet someone by: the first word of a person's name. Senders that are not a
  // person ("The Product Brief", "Issue 88 Weekly", newsletter@...) keep their full display name.
  function firstName(r) {
    var e = ea(r);
    var name = e.name.replace(/["']/g, '').trim();
    var local = e.address.split('@')[0];
    var words = name.split(/[\s,]+/).filter(Boolean);
    if (name && !/@/.test(name) && (/^the\s/i.test(name) || /\d/.test(name) || words.length >= 3 || ROLE_LOCAL.test(local))) return name;
    var w = words[0];
    if (w && !/@/.test(w)) return w;
    var local = e.address.split('@')[0].split(/[._+-]/)[0];
    return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'there';
  }

  function fillDraft(template, vars) {
    var v = vars || {};
    return str(template).replace(/\{(firstName|instruction)\}/g, function (all, k) {
      if (k === 'firstName') return str(v.firstName).trim() || 'there';
      return str(v.instruction).trim();
    });
  }

  // Graph calendar dateTime: no zone suffix means the zone the request asked for (UTC here).
  function eventMs(dt) {
    var s = str(dt);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return NaN;
    return Date.parse(/(Z|[+-]\d{2}:\d{2})$/.test(s) ? s : s.replace(/(\.\d{3})\d*$/, '$1') + 'Z');
  }

  function hm(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(str(s)); return m && Number(m[1]) < 25 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null; }

  // Does [startMs, endMs) overlap the day-job hours? days: 1=Mon … 7=Sun (default Mon–Fri).
  function workHoursClash(startMs, endMs, wh) {
    if (!wh || !isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) return false;
    var a = hm(wh.start), b = hm(wh.end);
    if (a == null || b == null || b <= a) return false;
    var days = Array.isArray(wh.days) && wh.days.length ? wh.days : [1, 2, 3, 4, 5];
    var tz = wh.tz || DEFAULT_TZ;
    // Walk the meeting in 15-minute steps (meetings are short; cap at 2 days).
    var stop = Math.min(endMs, startMs + 2 * 86400000);
    for (var t = startMs; t < stop; t += 15 * 60000) {
      var z = zoned(t, tz);
      if (!z) return false;
      var iso = z.wd === 0 ? 7 : z.wd;
      var mins = z.h * 60 + z.min;
      if (days.indexOf(iso) !== -1 && mins >= a && mins < b) return true;
    }
    return false;
  }

  function threadText(strip, nowMs, opts) {
    if (!strip || !(strip.count > 1)) return '';
    var parts = ['Thread of ' + strip.count];
    parts.push(strip.fromMe ? strip.fromMe + ' from you' : 'none from you');
    var ago = agoText(strip.latestAt, nowMs, opts);
    if (ago) parts.push('latest ' + ago);
    return parts.join(' · ');
  }

  // Plain words for a failed Graph / API call. Never echoes the raw error message.
  function errorText(err) {
    var s = err && typeof err.status === 'number' ? err.status : -1;
    var code = str(err && err.code);
    if (s === 0 && code === 'network') return { text: 'You seem to be offline. Check your connection and try again.', retry: true };
    if (code === 'no_token' || s === 401) return { text: 'Your Microsoft sign-in has expired. Sign in again to keep going.', retry: false, signIn: true };
    if (s === 403) return { text: 'Microsoft 365 said this account can\'t do that.', retry: false };
    if (s === 404) return { text: 'Couldn\'t find that email. It may have been moved or deleted in Outlook.', retry: true };
    if (s === 429) return { text: 'Microsoft asked us to slow down. Give it a minute, then try again.', retry: true };
    if (s >= 500) return { text: 'Microsoft 365 isn\'t answering right now. Try again in a moment.', retry: true };
    return { text: 'Something went wrong on our side. Try again.', retry: true };
  }

  var LABEL_NAMES = { needs_you: 'Needs you', waiting: 'Waiting', fyi: 'FYI', receipt: 'Receipt', noise: 'Low priority', newsletter: 'Newsletter', unsure: 'Unsure' };
  function labelName(label) { return Object.prototype.hasOwnProperty.call(LABEL_NAMES, label) ? LABEL_NAMES[label] : null; }

  function isAutomated(msg) {
    return !!header(msg, 'list-unsubscribe') || AUTOMATED.test(ea(msg && msg.from).address);
  }

  // Real-mode labels from valeMailState ({at, triaged:[{id,label,why,by}], waiting:[{conversationId,toName,days}]}).
  function triageLabels(state, inbox) {
    var out = {};
    if (!state || typeof state !== 'object') return out;
    (state.triaged || []).forEach(function (t) {
      if (t && typeof t.id === 'string' && t.label) out[t.id] = { label: t.label, why: str(t.why), by: t.by || null };
    });
    (state.waiting || []).forEach(function (w) {
      if (!w || !w.conversationId) return;
      var newest = null;
      (inbox || []).forEach(function (m) {
        if (m && m.conversationId === w.conversationId && (!newest || str(m.receivedDateTime) > str(newest.receivedDateTime))) newest = m;
      });
      if (newest) out[newest.id] = { label: 'waiting', why: 'You wrote to ' + (str(w.toName) || 'them') + ' ' + (Number(w.days) || 0) + ' days ago; no answer yet', by: 'rule' };
    });
    return out;
  }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(u8) {
    var out = '', i;
    for (i = 0; i + 2 < u8.length; i += 3) {
      var n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
      out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63];
    }
    var rest = u8.length - i;
    if (rest === 1) { var a = u8[i] << 16; out += B64[a >> 18 & 63] + B64[a >> 12 & 63] + '=='; }
    else if (rest === 2) { var b = (u8[i] << 16) | (u8[i + 1] << 8); out += B64[b >> 18 & 63] + B64[b >> 12 & 63] + B64[b >> 6 & 63] + '='; }
    return out;
  }
  // Inline (cid:) images for the reader: raster types only, never SVG or HTML.
  function bytesToDataUrl(buf, contentType) {
    var ct = str(contentType).toLowerCase().split(';')[0].trim();
    if (!/^image\/(png|gif|jpe?g|webp|bmp)$/.test(ct) || !buf) return null;
    return 'data:' + ct + ';base64,' + base64(new Uint8Array(buf));
  }

  var _exports = {
    formatWhen: formatWhen, formatTime: formatTime, agoText: agoText, formatSize: formatSize, firstName: firstName,
    fillDraft: fillDraft, eventMs: eventMs, workHoursClash: workHoursClash, threadText: threadText,
    errorText: errorText, labelName: labelName, isAutomated: isAutomated, triageLabels: triageLabels,
    bytesToDataUrl: bytesToDataUrl, domainMatches: domainMatches,
    safeBodyDoc: safeBodyDoc, hasRemoteImages: hasRemoteImages, htmlToText: htmlToText, textToHtml: textToHtml,
    replyTargets: replyTargets, replyToMismatch: replyToMismatch, findQuestion: findQuestion,
    threadStrip: threadStrip, waitingOnYou: waitingOnYou, bucketOf: bucketOf, counts: counts,
    isClientMsg: isClientMsg, threadIsClient: threadIsClient, isSimpleHtml: isSimpleHtml, searchQuery: searchQuery, sendMachine: sendMachine, shortcutFor: shortcutFor,
    escapeHtml: escapeHtml
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
  else if (root) root.ValeMailCore = _exports;
})(typeof window !== 'undefined' ? window : this);
