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
  var URL_ATTRS = ['href', 'src', 'xlink:href', 'background', 'poster', 'lowsrc', 'dynsrc', 'data', 'cite', 'longdesc', 'action'];
  var LINK_ATTRS = ['href', 'xlink:href', 'action'];
  // target/formtarget: a link must never pick its own browsing context (_self, _parent, a named
  // frame), or it could navigate the reader frame; links always use the document's <base target="_blank">.
  // attributionsrc: an Attribution Reporting beacon the browser requests in the background;
  // referrerpolicy: only the sanitiser picks it (no-referrer on every image).
  var DROP_ATTRS = ['ping', 'srcdoc', 'formaction', 'action', 'http-equiv', 'target', 'formtarget',
    'attributionsrc', 'referrerpolicy'];
  // Any other attribute named like a URL source (…src, …srcset) that the code doesn't handle
  // is dropped, so a future browser feature can't turn it into a request.
  var KNOWN_SRC = ['src', 'srcset', 'lowsrc', 'dynsrc'];

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

  var ATTR_NAME_OK = /^[a-z_:][a-z0-9_:.-]*$/i;
  var TAG_NAME_OK = /^[a-z][a-z0-9:-]*$/i;
  var WS = /[\t\n\f\r ]/;

  // attrs: [{ name, value, hasVal }] exactly as the browser's tokenizer reads them.
  function cleanTag(name, attrs, selfClose, inline) {
    var isLink = /^(?:[a-z0-9-]+:)?(a|area)$/i.test(name);
    var out = [];
    var seen = {};
    attrs.forEach(function (a) {
      var an = a.name.toLowerCase();
      var val = a.value;
      // Only plain attribute names survive; the browser keeps the first of duplicates, so do we.
      if (!ATTR_NAME_OK.test(an) || seen[an]) return;
      seen[an] = 1;
      if (/^on/.test(an) || DROP_ATTRS.indexOf(an) !== -1) return;
      if (/src(set)?$/.test(an) && KNOWN_SRC.indexOf(an) === -1) return;
      if (isLink && an === 'rel') return;
      if (an === 'style' && /expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(decodeEntities(val))) return;
      if (URL_ATTRS.indexOf(an) !== -1) {
        if (!a.hasVal) return;
        if (an === 'src' && /^\s*cid:/i.test(val) && inline) {
          var hit = inline[normCid(val.replace(/^\s*cid:/i, ''))];
          if (typeof hit === 'string' && /^data:image\//i.test(hit)) val = hit;
        }
        // An unresolved cid: can never load in a browser (and trips the page CSP): drop it, and
        // mark the image so a reader still fetching attachments can show a neutral placeholder.
        if (an === 'src' && /^cid:/.test(urlForCheck(val))) { out.push(' data-vm-cid'); return; }
        // Unsafe URLs are removed outright (never rewritten to "#", which would open this page).
        if (unsafeUrl(val, an)) return;
      }
      out.push(a.hasVal ? ' ' + an + '="' + val.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"' : ' ' + an);
    });
    if (isLink) out.push(' rel="noopener noreferrer"');
    if (/^img$/i.test(name)) out.push(' referrerpolicy="no-referrer"');
    return '<' + name + out.join('') + (selfClose ? ' />' : '>');
  }

  // Reads one tag the way the HTML tokenizer does (WHATWG 13.2.5): a quote only opens a value
  // right after "=", so a '"' in attribute-name position is part of the name. Returns
  // { end, name, attrs, selfClose, isEnd }, or null when the input ends inside the tag (the
  // browser drops such a tag, and so do we).
  function readTag(s, i) {
    var isEnd = s[i + 1] === '/';
    var j = i + (isEnd ? 2 : 1);
    var n = s.length;
    var name = '';
    while (j < n && !WS.test(s[j]) && s[j] !== '/' && s[j] !== '>') name += s[j++];
    var attrs = [], selfClose = false;
    for (;;) {
      while (j < n && (WS.test(s[j]) || s[j] === '/')) {
        selfClose = s[j] === '/' && s[j + 1] === '>';
        j++;
      }
      if (j >= n) return null;
      if (s[j] === '>') return { end: j + 1, name: name, attrs: attrs, selfClose: selfClose, isEnd: isEnd };
      selfClose = false;
      var an = s[j++]; // the first character may be "=" (it is then part of the name)
      while (j < n && !WS.test(s[j]) && s[j] !== '/' && s[j] !== '>' && s[j] !== '=') an += s[j++];
      while (j < n && WS.test(s[j])) j++;
      var val = '', hasVal = false;
      if (s[j] === '=') {
        hasVal = true;
        j++;
        while (j < n && WS.test(s[j])) j++;
        if (j >= n) return null;
        if (s[j] === '"' || s[j] === "'") {
          var k = s.indexOf(s[j], j + 1);
          if (k === -1) return null;
          val = s.slice(j + 1, k);
          j = k + 1;
        } else {
          while (j < n && !WS.test(s[j]) && s[j] !== '>') val += s[j++];
        }
      }
      attrs.push({ name: an, value: val, hasVal: hasVal });
    }
  }

  // Every "<" in the output is one this function rebuilt; every other "<" and ">" is escaped,
  // so the browser can never see a tag the sanitiser didn't (no parser differential).
  function sanitizeHtml(src, inline) {
    var map = null;
    if (inline && typeof inline === 'object') {
      map = {};
      Object.keys(inline).forEach(function (k) { map[normCid(k)] = inline[k]; });
    }
    var s = str(src);
    s = s.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
    s = s.replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g, '');
    s = s.replace(DROP_WITH_CONTENT, '');
    var out = [];
    var i = 0, n = s.length;
    while (i < n) {
      var lt = s.indexOf('<', i);
      var text = lt === -1 ? s.slice(i) : s.slice(i, lt);
      if (text) out.push(text.replace(/>/g, '&gt;'));
      if (lt === -1) break;
      i = lt;
      var c1 = s[i + 1] || '', c2 = s[i + 2] || '';
      var isStart = /[a-z]/i.test(c1), isEnd = c1 === '/' && /[a-z]/i.test(c2);
      if (!isStart && !isEnd) {
        // "<!x", "<?x", "</>" and "</ x" are bogus comments up to the next ">"; any other "<" is text.
        if (c1 === '!' || c1 === '?' || c1 === '/') {
          var gt = s.indexOf('>', i);
          i = gt === -1 ? n : gt + 1;
        } else { out.push('&lt;'); i++; }
        continue;
      }
      var t = readTag(s, i);
      if (!t) break; // the input ends inside a tag: the browser drops it, and so do we
      i = t.end;
      var local = t.name.toLowerCase().split(':').pop();
      if (!TAG_NAME_OK.test(t.name) || DROP_TAGS.indexOf(local) !== -1) continue;
      if (t.isEnd) { out.push('</' + t.name + '>'); continue; }
      out.push(cleanTag(t.name, t.attrs, t.selfClose, map));
      if (local === 'style') {
        // Raw CSS up to </style>. "<" is re-escaped, so nothing in it can ever start a tag.
        var m = /<\/style[\t\n\f\r \/>]/i.exec(s.slice(i));
        var css = m ? s.slice(i, i + m.index) : s.slice(i);
        out.push(css.replace(/</g, '\\3c '));
        i = m ? i + m.index : n;
        if (!m) out.push('</style>');
      }
    }
    return out.join('');
  }

  // Images hidden = an allow-list, not a deny-list: browsers read "\" as "/", "http:host" as a
  // remote host, and so on, so only targets that cannot leave the email are kept.
  function localImageUrl(v) { var u = urlForCheck(v).replace(/\\/g, '/'); return /^(data:image\/|cid:|#)/.test(u); }
  function localCssTarget(t) {
    var u = str(t).trim().replace(/^["']|["']$/g, '').replace(/[\u0000- ]/g, '').replace(/\\/g, '/').toLowerCase();
    return /^(data:|#)/.test(u);
  }

  // CSS escapes (\72, \000072 , \() decoded the way the browser does; leftover backslashes are
  // dropped so nothing can be re-escaped into a URL after this.
  function cssDecode(s) {
    return str(s).replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?/gi, function (all, hex) {
      var n = parseInt(hex, 16);
      if (!n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return String.fromCharCode(0xfffd);
      return String.fromCodePoint(n);
    }).replace(/\\([^\n\r\f0-9a-f])/gi, '$1').replace(/\\/g, '');
  }

  // Rewrites decoded CSS so only local targets (data:, #fragment) survive in url() and
  // image-set()/image(), and no @import survives at all. Returns null when nothing was changed
  // (the caller then keeps the original text untouched).
  function cssWithoutRemote(decoded) {
    var hit = false;
    var out = decoded.replace(/@import\b[^;]*;?/gi, function () { hit = true; return ''; })
      // src() is a URL function too (CSS Values 4): treated exactly like url().
      .replace(/\b(?:url|src)\(([^)]*)\)/gi, function (all, inner) { if (!localCssTarget(inner)) { hit = true; return 'none'; } return all; })
      .replace(/(?:-webkit-)?image(?:-set)?\(((?:[^()]|\([^()]*\))*)\)/gi, function (all, inner) {
        // Whatever is left once local url()s and local strings are taken out must not look like a URL.
        var rest = inner.replace(/url\([^)]*\)/gi, '').replace(/"[^"]*"|'[^']*'/g, function (q) { return localCssTarget(q) ? '' : 'x:'; });
        if (/[\/:]/.test(rest)) { hit = true; return 'none'; }
        return all;
      });
    return hit ? out : null;
  }

  var IMAGE_ATTRS = /\s(src|background|poster|lowsrc|dynsrc)="([^"]*)"/gi;

  // Runs on sanitizeHtml output, where every attribute value is double-quoted.
  function stripRemoteImages(s) {
    return str(s)
      // <style> blocks: CSS escapes (and, for SVG <style>, entities). '<' is re-escaped so a
      // decoded "\3c /style\3e" can never close the block.
      .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, function (all, open, css, close) {
        var clean = cssWithoutRemote(cssDecode(decodeEntities(css)));
        return clean === null ? all : open + clean.replace(/</g, '\\3c ') + close;
      })
      // Every attribute pass runs inside one tag, never over text: a literal '"' in a text node
      // would otherwise pair with a real attribute's opening quote and hide that attribute.
      // Rebuilt tags never hold a raw '>' in a value (the sanitiser escapes it), so
      // /<[a-z][^>]*>/ spans exactly one tag.
      .replace(/<[a-z][^>]*>/gi, function (tag) {
        // Any attribute that holds CSS (style="", and SVG fill/filter/mask="url(...)"): HTML
        // entities first, then CSS escapes, as the browser does.
        var t = tag.replace(/\s([a-z_:][a-z0-9_:.-]*)="([^"]*)"/gi, function (all, a, v) {
          var dec = cssDecode(decodeEntities(v));
          if (!/(?:url|src)\s*\(|image(?:-set)?\s*\(|@import/i.test(dec)) return all;
          var clean = cssWithoutRemote(dec);
          return clean === null ? all : ' ' + a + '="' + escapeHtml(clean) + '"';
        })
          .replace(IMAGE_ATTRS, function (all, a, v) { return localImageUrl(v) ? all : ''; })
          .replace(/\ssrcset="([^"]*)"/gi, function (all, v) {
            var parts = decodeEntities(v).split(/,(?=\s*[^\s,]+(?:\s|$))/);
            return parts.every(function (p) { return localImageUrl(p.trim().split(/\s+/)[0]); }) ? all : '';
          });
        // SVG images: <image>, <feImage> and <use> fetch their href.
        if (/^<(?:[a-z0-9-]+:)?(?:image|feimage|use)\b/i.test(t)) {
          t = t.replace(/\s(?:xlink:)?href="([^"]*)"/gi, function (a, v) { return localImageUrl(v) ? a : ''; });
        }
        return t;
      });
  }

  var BASE_CSS ='html,body{margin:0;padding:0}body{padding:16px;font:14px/1.55 -apple-system,"Segoe UI",system-ui,sans-serif;' +
    'color:#1d1d1f;background:#fff;color-scheme:light;overflow-wrap:anywhere}img{max-width:100%;height:auto}' +
    'pre.vm-text{white-space:pre-wrap;font:inherit;margin:0}a{color:#5b4fd6}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:2px solid #d4d4dc;color:#555}' +
    'details.vm-quote{margin:12px 0 0}details.vm-quote>summary{display:inline-block;list-style:none;cursor:pointer;padding:0 8px;' +
    'border-radius:6px;background:#ececf1;color:#555;font-weight:700;letter-spacing:1px;line-height:18px}' +
    'details.vm-quote>summary::-webkit-details-marker{display:none}details.vm-quote>summary:focus-visible{outline:2px solid #5b4fd6;outline-offset:2px}' +
    'details.vm-quote[open]>summary{margin-bottom:8px}' +
    // Inline images still being fetched: a quiet grey box (a blank 1x1 image), never a broken-image glyph.
    '.vm-cid-wait img[data-vm-cid]{display:inline-block;min-width:120px;min-height:90px;border-radius:6px;background:#ececf1;vertical-align:middle}';

  // A transparent 1x1 GIF: the src a pending inline image gets, so it draws as a box, not a broken image.
  var BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  // Where quoted history starts in sanitised HTML (every "<" in it is a tag the sanitiser
  // rebuilt, with double-quoted attributes): Outlook's divRplyFwdMsg / appendonsend, Gmail's
  // gmail_quote, a <blockquote>, or an <hr>/<div>/<p> whose text starts "From: … Sent:".
  // Returns the index of that tag, or -1 when there is none or nothing new comes before it.
  function quoteStartHtml(s) {
    s = str(s);
    var best = -1;
    function take(i) { if (i !== -1 && (best === -1 || i < best)) best = i; }
    var m;
    m = /<div\b[^>]*\sid="(?:divrplyfwdmsg|appendonsend)"/i.exec(s); if (m) take(m.index);
    m = /<(?:div|blockquote)\b[^>]*\sclass="[^"]*\bgmail_quote(?:_container)?(?=[\s"])/i.exec(s); if (m) take(m.index);
    m = /<blockquote\b/i.exec(s); if (m) take(m.index);
    var re = /<(?:hr|div|p)\b[^>]*>/gi;
    while ((m = re.exec(s)) && (best === -1 || m.index < best)) {
      var txt = htmlToText(s.slice(m.index, m.index + 800)).replace(/^\s+/, '');
      if (/^from:\s/i.test(txt) && /\b(?:sent|date):/i.test(txt.slice(0, 400))) { take(m.index); break; }
    }
    if (best <= 0 || !htmlToText(s.slice(0, best)).trim()) return -1;
    return best;
  }
  // Folds quoted history into a script-free <details> (closed), so the newest message reads first.
  function foldQuotedHtml(s) {
    var at = quoteStartHtml(s);
    if (at === -1) return s;
    return s.slice(0, at) + '<details class="vm-quote"><summary title="Show quoted text" aria-label="Show quoted text">···</summary>' +
      s.slice(at) + '</details>';
  }

  // Full HTML document for <iframe sandbox srcdoc>. Defence in depth: the sandbox (no
  // allow-scripts / allow-same-origin) and the CSP meta already stop scripts and remote
  // loads; the sanitiser also removes them so nothing depends on one layer.
  // opts.cidPending: the reader is still fetching inline (cid:) images; they show as placeholders.
  function safeBodyDoc(body, allowImages, inlineImages, opts) {
    var b = body || {};
    var isHtml = str(b.contentType).toLowerCase() === 'html';
    var inner = isHtml ? foldQuotedHtml(sanitizeHtml(b.content, inlineImages)) : '<pre class="vm-text">' + escapeHtml(b.content) + '</pre>';
    // Images hidden: remove remote image URLs outright, so nothing is even requested
    // (tracking pixels never fire) and nothing depends on the CSP alone.
    if (isHtml && !allowImages) inner = stripRemoteImages(inner);
    // Unresolved inline images lost their cid: src in the sanitiser; while they load they get a
    // blank local image (the sanitiser keeps only one src, so this is the only one).
    if (isHtml && opts && opts.cidPending) inner = inner.replace(/(<img\b[^>]*?\sdata-vm-cid)(?=[\s>\/])/gi, function (all, head) { return head + ' src="' + BLANK_GIF + '"'; });
    var csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:" + (allowImages ? ' https:' : '') + "; font-src data:; form-action 'none'";
    // no-referrer: a srcdoc frame inherits this page's referrer, so a shown image would tell the
    // sender's server the mail was read here. Mail's own <meta> tags are removed, so this holds.
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="referrer" content="no-referrer">' +
      '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
      '<base target="_blank"><style>' + BASE_CSS + '</style></head><body' + (opts && opts.cidPending ? ' class="vm-cid-wait"' : '') + '>' + inner + '</body></html>';
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

  // What kind of answer the question wants, so one tap never drafts nonsense:
  //   'choice' — "A or B?" (one button per option), 'open' — what/how/when/... (no Yes/No),
  //   'yesno' — starts with an auxiliary verb ("Could we…?") or is a short fragment ("Saturday?").
  var AUX = /^(do|does|did|can|could|would|will|are|is|was|were|should|have|has|had|may|might|want|shall|am|must|need)\b/i;
  var WH = /^(what|how|when|where|why|which|who|whom|whose)\b/i;
  var OPENERS = /^(?:(?:and|also|so|but|ok|okay|hey|hi|quick question|one more thing)\b[,:\s-]*)+/i;

  function cleanQuestion(q) {
    var s = str(q).trim();
    // "One real ask: can you confirm…?" — the question is what follows the lead-in.
    var colon = s.lastIndexOf(':');
    if (colon !== -1) {
      var tail = s.slice(colon + 1).trim();
      if (AUX.test(tail.replace(OPENERS, '')) || WH.test(tail.replace(OPENERS, ''))) s = tail;
    }
    return s.replace(OPENERS, '').replace(/\s+or\s+(?:not|no)\b[^?]*/i, '').trim();
  }

  function choiceOptions(q) {
    var s = cleanQuestion(q);
    var m = /^(.+?)\s+or\s+(.+?)\s*\?$/i.exec(s);
    if (!m) return null;
    var left = m[1], right = m[2].replace(/^(?:(?:the\s+)?(?:other|either)|not|no|what|something)\b.*$/i, '');
    if (!right) return null;
    var a;
    var cut = left.split(/[,:;]/);
    if (cut.length > 1) a = cut[cut.length - 1].trim();
    else {
      var words = left.trim().split(/\s+/);
      var n = right.trim().split(/\s+/).length;
      a = words.slice(Math.max(0, words.length - n)).join(' ');
    }
    a = a.replace(/^(?:either|between)\s+/i, '').trim();
    var b = right.trim();
    if (!a || !b || a.length > 40 || b.length > 40 || AUX.test(a) || WH.test(a)) return null;
    return [a, b];
  }

  function questionKind(q) {
    var s = cleanQuestion(q);
    if (!s) return 'open';
    if (choiceOptions(s)) return 'choice';
    // An either/or too long to put on buttons is not a yes/no question either.
    if (WH.test(s) || /\s+or\s+/i.test(s)) return 'open';
    return 'yesno';
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
  // Outlook replies carry <hr> between messages, so it (and headings, pre, small...) is "simple".
  var SIMPLE_TAGS = ['div', 'p', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 'blockquote', 'ul', 'ol', 'li',
    'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'small', 'sub', 'sup', 'font'];
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

  var KEYS = { j: 'next', k: 'prev', Enter: 'open', e: 'archive', r: 'reply', d: 'draft', f: 'flag', u: 'unread', z: 'undo', '/': 'search', '?': 'help', Escape: 'close', Esc: 'close' };

  function shortcutFor(event) {
    if (!event || typeof event.key !== 'string') return null;
    if (event.ctrlKey || event.metaKey || event.altKey) return null;
    var t = event.target || {};
    var tag = str(t.tagName).toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return null;
    return Object.prototype.hasOwnProperty.call(KEYS, event.key) ? KEYS[event.key] : null;
  }

  // The ARIA listbox keys, for when the message list itself has focus (the client only asks then),
  // so arrows stay native in the reader and in text fields.
  var LIST_KEYS = { ArrowDown: 'next', ArrowUp: 'prev', Down: 'next', Up: 'prev', Home: 'first', End: 'last' };
  function listKeyFor(event) {
    if (!event || typeof event.key !== 'string') return null;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
    var t = event.target || {};
    var tag = str(t.tagName).toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return null;
    return Object.prototype.hasOwnProperty.call(LIST_KEYS, event.key) ? LIST_KEYS[event.key] : null;
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
    if (code === 'timeout') return { text: 'Microsoft 365 took too long to answer. Check your connection and try again.', retry: true };
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

  // Role mailboxes nobody personally answers from (billing@, alerts@, desk@...).
  var MACHINE_LOCAL = /^(alerts?|desk|security|renewals?|receipts?|invoices?|accounts?|events?|surveys?|feedback|talent|careers|jobs|orders?|shipping|calendar|system|automated?|robot|postmaster)([+.-][^@]*)?$/;

  // opts.me / opts.agent: the user's and the agent's own addresses (a brief from the agent, or a
  // copy of your own mail, is never something to reply to), but only for provably internal mail:
  // an outside email that merely puts one of those addresses in From gets the normal treatment.
  function isAutomated(msg, opts) {
    var from = ea(msg && msg.from).address;
    if (header(msg, 'list-unsubscribe') || AUTOMATED.test(from)) return true;
    var local = from.split('@')[0];
    if (from && (ROLE_LOCAL.test(local) || MACHINE_LOCAL.test(local))) return true;
    var o = opts || {};
    return !!from && isInternal(msg) && [o.me, o.agent].some(function (x) { return meAddress(x) && meAddress(x) === from; });
  }

  // After a failed send: 'sent' (it went out after all), 'recreate' (the draft is gone: start a
  // fresh reply) or 'retry' (same draft, try again). A 404 on patch/send means the draft no
  // longer exists, usually because an earlier, timed-out send actually went through. probed: the
  // draft read back after a timeout / 5xx (see sendProbe); isDraft false means it was sent.
  function sendRecovery(err, sentItems, startedAt, conversationId, probed) {
    if (probed && probed.isDraft === false) return 'sent';
    var status = err && typeof err.status === 'number' ? err.status : -1;
    var gone = status === 404 || str(err && err.code) === 'ErrorItemNotFound';
    if (!gone) return 'retry';
    var since = Number(startedAt);
    var hit = (sentItems || []).some(function (m) {
      var t = Date.parse((m && m.sentDateTime) || '');
      return !!conversationId && m.conversationId === conversationId && isFinite(t) && (!isFinite(since) || t >= since - 60000);
    });
    return hit ? 'sent' : 'recreate';
  }

  function plainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  // Real mode: the three vale-state reads (triage state, rules, CEO profile) → page state.
  // A failed or malformed rules read sets rulesFailed, so client-thread checks fail closed.
  function valeStateFrom(responses) {
    var r = Array.isArray(responses) ? responses : [];
    function ok(x) { return !!x && x.status === 200 && plainObject(x.body); }
    var out = { sortState: 'failed', state: null, triagedAt: null, rules: {}, rulesFailed: true, workHours: null };
    if (ok(r[0])) {
      var v = r[0].body.value;
      if (v === null || v === undefined) out.sortState = 'ok';
      else if (plainObject(v)) {
        out.sortState = 'ok';
        out.state = v;
        out.triagedAt = typeof v.at === 'string' && isFinite(Date.parse(v.at)) ? v.at : null;
      }
    }
    if (ok(r[1]) && plainObject(r[1].body.rules)) { out.rules = r[1].body.rules; out.rulesFailed = false; }
    if (ok(r[2]) && plainObject(r[2].body.value) && plainObject(r[2].body.value.workHours)) {
      var wh = r[2].body.value.workHours;
      if (typeof wh.start === 'string' && typeof wh.end === 'string') out.workHours = wh;
    }
    return out;
  }

  // 0–4 is still last night, not morning.
  function greetingFor(hour) {
    var h = Number(hour);
    if (!isFinite(h)) return 'Hello';
    if (h < 5) return 'Working late';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  // Real-mode labels from valeMailState ({at, triaged:[{id,label,why,by}], waiting:[{conversationId,toName,days}]}).
  function triageLabels(state, inbox) {
    var out = {};
    if (!state || typeof state !== 'object') return out;
    (Array.isArray(state.triaged) ? state.triaged : []).forEach(function (t) {
      if (t && typeof t.id === 'string' && t.label) out[t.id] = { label: t.label, why: str(t.why), by: t.by || null };
    });
    (Array.isArray(state.waiting) ? state.waiting : []).forEach(function (w) {
      if (!w || !w.conversationId) return;
      var newest = null;
      (inbox || []).forEach(function (m) {
        if (m && m.conversationId === w.conversationId && (!newest || str(m.receivedDateTime) > str(newest.receivedDateTime))) newest = m;
      });
      if (newest) out[newest.id] = { label: 'waiting', why: 'You wrote to ' + (str(w.toName) || 'them') + '; no answer yet', by: 'rule' };
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

  // ── Who really sent it ─────────────────────────────────────────────────────

  // Provably internal: the sender is the From address and Exchange authenticated it as internal
  // mail (X-MS-Exchange-Organization-AuthAs: Internal). A From header alone proves nothing.
  function isInternal(msg) {
    if (!msg) return false;
    var from = ea(msg.from).address, sender = ea(msg.sender).address;
    return !!from && sender === from && header(msg, 'x-ms-exchange-organization-authas').trim().toLowerCase() === 'internal';
  }

  // From claims one of your own addresses (your domain) but the mail came from outside.
  function claimsOwnDomain(msg, ownDomain) {
    if (!msg || !ownDomain) return null;
    var from = ea(msg.from).address;
    if (!from || !domainMatches(from, [ownDomain]) || isInternal(msg)) return null;
    return { from: from };
  }

  function editDistance(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      var best = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > cap) return cap + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  function normName(s) { return str(s).toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim(); }

  // People you have written to (recipients of your sent mail): the correspondents a lookalike
  // would imitate. Inbox senders are never trusted this way (a lookalike is an inbox sender).
  function knownContacts(sentMsgs) {
    var seen = {}, out = [];
    (sentMsgs || []).forEach(function (m) {
      ((m && m.toRecipients) || []).concat((m && m.ccRecipients) || []).forEach(function (r) {
        var e = ea(r);
        if (!e.address || seen[e.address]) return;
        seen[e.address] = 1;
        out.push(e);
      });
    });
    return out;
  }

  // The one person a compose brief names ("tell Ravi the key is on its way"): capitalised words
  // matched against the first names of people. Returns { name, address, first } when exactly
  // one address matches, else null (no name, or two people share it). Only a suggestion: the
  // client never fills To with it on its own.
  function contactFromBrief(brief, people) {
    var words = {};
    (str(brief).match(/\b[A-Z][a-z][A-Za-z'’-]*/g) || []).forEach(function (w) { words[w.toLowerCase()] = 1; });
    var hits = {}, n = 0, pick = null;
    (people || []).forEach(function (p) {
      var e = ea(p);
      var first = e.name.replace(/["']/g, '').trim().split(/[\s,]+/)[0] || '';
      if (!e.address || !first || /@/.test(first) || !words[first.toLowerCase()]) return;
      if (hits[e.address]) return;
      hits[e.address] = 1;
      n++;
      pick = { name: e.name, address: e.address, first: first };
    });
    return n === 1 ? pick : null;
  }

  // A sender that looks like someone you know but isn't: the same display name under another
  // address, or a domain one or two letters off a known correspondent's. Returns
  // { from, known } (addresses) or null. A sender you have written to before is never flagged.
  function senderMismatch(msg, known) {
    if (!msg) return null;
    var from = ea(msg.from);
    if (!from.address) return null;
    var list = (known || []).map(ea).filter(function (k) { return k.address; });
    if (list.some(function (k) { return k.address === from.address; })) return null;
    var name = normName(from.name);
    var dom = domainOf(from.address);
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      if (name.length >= 3 && name.indexOf('@') === -1 && normName(k.name) === name) return { from: from.address, known: k.address };
    }
    for (var j = 0; j < list.length; j++) {
      var kd = domainOf(list[j].address);
      if (!kd || !dom || kd === dom || Math.min(kd.length, dom.length) < 6) continue;
      if (editDistance(dom, kd, 2) <= 2) return { from: from.address, known: list[j].address };
    }
    return null;
  }

  // ── Words that go stale ────────────────────────────────────────────────────

  // A saved reason ("You sent the contract 5 days ago") is written once at sorting time; its
  // relative time goes stale and contradicts the live facts, so it is removed before display.
  var REL_NUM = '(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|a few|several)';
  var REL_AGO = new RegExp('\\s*(?:about\\s+)?' + REL_NUM + '\\s+(?:min(?:ute)?s?|hours?|hrs?|days?|weeks?|months?)\\s+ago\\b', 'gi');
  var REL_DAY = /\s*\b(?:since\s+)?(?:yesterday|today|this morning|this afternoon|this evening|last night|tonight)\b/gi;
  function stripRelativeTime(why) {
    var s = str(why).replace(REL_AGO, '').replace(REL_DAY, '');
    return s.replace(/\s+([;,.:!?])/g, '$1').replace(/\s{2,}/g, ' ').replace(/^[\s;,]+|[\s;,]+$/g, '').trim();
  }

  // ── Plain-text quoted history ──────────────────────────────────────────────

  // { body, quote }: quote starts at the first "On … wrote:" line or the first line that begins
  // with ">", with the ">" prefixes removed. A ">" inside a sentence stays body.
  function splitQuoted(text) {
    var lines = str(text).replace(/\r\n?/g, '\n').split('\n');
    var at = -1;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (/^\s*>/.test(l)) { at = i; break; }
      if (/^\s*On\b.{4,200}\bwrote:\s*$/.test(l)) { at = i; break; }
      // The "On … <address>" line with "wrote:" wrapped onto the next line.
      if (/^\s*On\b.{4,200}$/.test(l) && i + 1 < lines.length && /^\s*wrote:\s*$/.test(lines[i + 1])) { at = i; break; }
    }
    if (at === -1) return { body: str(text), quote: '' };
    var body = lines.slice(0, at).join('\n').replace(/\s+$/, '');
    var quote = lines.slice(at).map(function (l) { return l.replace(/^\s*(?:>\s?)+/, ''); }).join('\n').replace(/^\s+|\s+$/g, '');
    return { body: body, quote: quote };
  }

  // Bracketed gaps a draft leaves for Chad ("[day]", "[Your answer here.]"), in the reply only:
  // quoted history below it is someone else's text. Each distinct gap once, in order.
  function findPlaceholders(text) {
    var body = splitQuoted(text).body;
    var out = [];
    // Only gaps shaped like Vale's (words, with lowercase): not "[1]" footnotes, "[sic]",
    // "[EXTERNAL]" tags, "/items/[id]" paths or "[text](link)" markdown Chad typed himself.
    var re = /(^|[^\w\/\]])(\[([A-Za-z][A-Za-z ,.'’-]{0,38})\])(?!\()/g;
    var mm;
    while ((mm = re.exec(body))) {
      var p = mm[2], inner = mm[3];
      if (!/[a-z]/.test(inner) || /^sic$/i.test(inner.trim())) continue;
      if (out.indexOf(p) === -1) out.push(p);
    }
    return out;
  }

  // ── Loads that may land out of order ───────────────────────────────────────

  // list state: { items, next, loading, loaded, error, seq }. listBegin returns a token (or null:
  // a "more" while another load is in flight is ignored); listSettle applies a result only when
  // its token is still the newest, so an older listing never overwrites a newer one.
  function listBegin(L, more) {
    if (more && L.loading) return null;
    L.seq = (L.seq || 0) + 1;
    L.loading = true;
    L.error = null;
    return { seq: L.seq, more: !!more };
  }
  function listSettle(L, token, res, err) {
    if (!token || token.seq !== L.seq) return false;
    if (err) L.error = err;
    else {
      var items = (res && res.items) || [];
      L.items = token.more ? L.items.concat(items.filter(function (m) { return !L.items.some(function (x) { return x.id === m.id; }); })) : items;
      L.next = (res && res.next) || null;
      L.loaded = true;
    }
    L.loading = false;
    return true;
  }

  // The client flag for a reply draft: client anywhere in the whole conversation (fetched from
  // Graph, not just the loaded pages). A conversation that couldn't be fetched (null), or rules
  // that failed to load, fail closed.
  function draftClientFlag(o) {
    o = o || {};
    if (o.rulesFailed || !Array.isArray(o.conversation)) return true;
    return threadIsClient(o.conversation.concat(o.loaded || []), o.domains || []);
  }

  // After a failed send POST: what to check. 'message' (a timeout, network error or 5xx: the
  // send may have landed, so read the draft back; isDraft false means it went), 'sent' (a 404:
  // the draft is gone, look in Sent) or null (a clear 4xx: it did not send).
  function sendProbe(err) {
    var s = err && typeof err.status === 'number' ? err.status : -1;
    if (s === 404 || str(err && err.code) === 'ErrorItemNotFound') return 'sent';
    if (s === 0 || s >= 500) return 'message';
    return null;
  }

  var _exports = {
    formatWhen: formatWhen, formatTime: formatTime, agoText: agoText, formatSize: formatSize, firstName: firstName,
    fillDraft: fillDraft, eventMs: eventMs, workHoursClash: workHoursClash, threadText: threadText,
    errorText: errorText, labelName: labelName, isAutomated: isAutomated, triageLabels: triageLabels,
    bytesToDataUrl: bytesToDataUrl, domainMatches: domainMatches,
    safeBodyDoc: safeBodyDoc, hasRemoteImages: hasRemoteImages, htmlToText: htmlToText, textToHtml: textToHtml,
    replyTargets: replyTargets, replyToMismatch: replyToMismatch, findQuestion: findQuestion,
    threadStrip: threadStrip, waitingOnYou: waitingOnYou, bucketOf: bucketOf, counts: counts,
    isClientMsg: isClientMsg, threadIsClient: threadIsClient, isSimpleHtml: isSimpleHtml, searchQuery: searchQuery, sendMachine: sendMachine, shortcutFor: shortcutFor, listKeyFor: listKeyFor, contactFromBrief: contactFromBrief,
    escapeHtml: escapeHtml,
    questionKind: questionKind, choiceOptions: choiceOptions, sendRecovery: sendRecovery,
    valeStateFrom: valeStateFrom, greetingFor: greetingFor,
    isInternal: isInternal, claimsOwnDomain: claimsOwnDomain, knownContacts: knownContacts, senderMismatch: senderMismatch,
    stripRelativeTime: stripRelativeTime, splitQuoted: splitQuoted, findPlaceholders: findPlaceholders, quoteStartHtml: quoteStartHtml, listBegin: listBegin, listSettle: listSettle,
    draftClientFlag: draftClientFlag, sendProbe: sendProbe
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
  else if (root) root.ValeMailCore = _exports;
})(typeof window !== 'undefined' ? window : this);
