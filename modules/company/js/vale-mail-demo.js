// Vale Mail — demo backend: an in-memory fake Microsoft Graph over the fixture mailbox.
//
// Runs in the browser (window.ValeMailDemo) and under node tests (module.exports).
// Same interface as the real client (vale-graph-browser.js METHODS), so the UI never knows
// which backend it has. Nothing leaves the page: every call resolves from memory after a
// simulated 150–400 ms delay, and mutations (read, flag, archive, drafts, send) persist for
// the page session only. Every fixture date is shifted by (now - anchor) so the mailbox
// always looks current. Errors are GraphError-shaped ({name, status, code}) like the real one.
// Plan: docs/superpowers/plans/2026-10-17-vale-mail-overnight.md (Task 4).

(function (root) {
  'use strict';

  var MAX_TOP = 50;
  var SEARCH_CAP = 50;
  var FLAG_STATUSES = ['flagged', 'notFlagged', 'complete'];
  var EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
  var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
  var LISTED = ['inbox', 'sentitems', 'archive', 'drafts'];
  var MSG_DATES = ['receivedDateTime', 'sentDateTime', 'createdDateTime', 'lastModifiedDateTime'];

  function demoError(status, code, message) {
    var e = new Error('graph ' + status + ' ' + code + (message ? ': ' + message : ''));
    e.name = 'GraphError';
    e.status = status;
    e.code = code;
    return e;
  }
  function notFound() { return demoError(404, 'ErrorItemNotFound', 'not found'); }
  function badArg(what) { return demoError(400, 'ErrorInvalidRequest', what); }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  // Shift an ISO timestamp by ms. "…Z" / offset forms come back as toISOString(); Graph's
  // calendar form ("2026-10-17T17:00:00.0000000", zone given separately) keeps its shape.
  function shiftIso(s, ms) {
    if (typeof s !== 'string' || !ISO_RE.test(s)) return s;
    var zoned = /(Z|[+-]\d{2}:\d{2})$/.test(s);
    var t = Date.parse(zoned ? s : s.replace(/(\.\d{3})\d*$/, '$1') + 'Z');
    if (!isFinite(t)) return s;
    var out = new Date(t + ms).toISOString();
    return zoned ? out : out.replace(/\.\d{3}Z$/, '.0000000');
  }

  function decodeBase64(b64) {
    var bin;
    if (typeof atob === 'function') bin = atob(String(b64 || ''));
    else bin = Buffer.from(String(b64 || ''), 'base64').toString('binary');
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  function addrOf(r) { return (r && r.emailAddress && typeof r.emailAddress.address === 'string') ? r.emailAddress.address : ''; }

  function recipients(list) {
    var arr = Array.isArray(list) ? list : [list];
    return arr.map(function (r) {
      var address = (typeof r === 'string' ? r : addrOf(r)).trim();
      if (!EMAIL_RE.test(address)) throw badArg('recipient');
      var out = { emailAddress: { address: address } };
      var name = r && typeof r === 'object' && r.emailAddress && r.emailAddress.name;
      if (typeof name === 'string' && name) out.emailAddress.name = name;
      return out;
    });
  }

  function flagOf(flag) {
    if (flag === true) return { flagStatus: 'flagged' };
    if (flag === false) return { flagStatus: 'notFlagged' };
    if (flag && typeof flag === 'object' && FLAG_STATUSES.indexOf(flag.flagStatus) !== -1) return { flagStatus: flag.flagStatus };
    throw badArg('flag');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // The shared core's text conversion, so numeric and hex entities (&#39; from textToHtml) decode.
  var Core = (typeof module !== 'undefined' && module.exports) ? require('./vale-mail-core.js') : (root && root.ValeMailCore);
  function previewOf(html) {
    return Core.htmlToText(String(html || '')).replace(/\s+/g, ' ').trim().slice(0, 255);
  }
  function when(m) { return m.receivedDateTime || m.sentDateTime || ''; }
  function listView(m) { var c = clone(m); delete c.body; return c; }

  // opts: { now?() -> ms, latency?: number | () -> ms, sleep?(ms), random?() }
  function createDemoGraph(fixture, opts) {
    if (!fixture || typeof fixture !== 'object' || !fixture.folders || typeof fixture.folders !== 'object') {
      throw new Error('createDemoGraph: fixture with folders is required');
    }
    opts = opts || {};
    var now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
    var random = typeof opts.random === 'function' ? opts.random : Math.random;
    var sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var latency = typeof opts.latency === 'function' ? opts.latency
      : (typeof opts.latency === 'number' ? function () { return opts.latency; }
        : function () { return 150 + Math.round(random() * 250); });

    var anchorMs = Date.parse(fixture.anchor);
    var delta = isFinite(anchorMs) ? now() - anchorMs : 0;

    var store = {};      // id -> message (with parentFolderId)
    var order = [];      // insertion order, for stable ties
    Object.keys(fixture.folders).forEach(function (folder) {
      (fixture.folders[folder] || []).forEach(function (src) {
        var m = clone(src);
        m.parentFolderId = folder;
        MSG_DATES.forEach(function (k) { if (m[k]) m[k] = shiftIso(m[k], delta); });
        store[m.id] = m;
        order.push(m.id);
      });
    });
    var attachments = clone(fixture.attachments || {});
    var calendar = (clone(fixture.calendar) || []).map(function (ev) {
      if (ev.start && ev.start.dateTime) ev.start.dateTime = shiftIso(ev.start.dateTime, delta);
      if (ev.end && ev.end.dateTime) ev.end.dateTime = shiftIso(ev.end.dateTime, delta);
      return ev;
    });
    var me = clone(fixture.me) || { displayName: '', mail: '' };
    var myAddr = String(me.mail || '').toLowerCase();
    var extras = {
      labels: fixture.labels || {}, rules: fixture.rules || {}, workHours: fixture.workHours || null,
      drafts: fixture.drafts || {}, folderList: fixture.folderList || [],
      triagedAt: fixture.triagedAt ? shiftIso(fixture.triagedAt, delta) : null
    };
    var seq = 0;

    function folderKnown(f) { return LISTED.indexOf(f) !== -1 || Object.prototype.hasOwnProperty.call(fixture.folders, f); }

    function sorted(filter) {
      return order.map(function (id) { return store[id]; }).filter(Boolean).filter(filter)
        .map(function (m, i) { return { m: m, i: i }; })
        .sort(function (a, b) { var x = when(a.m), y = when(b.m); return x < y ? 1 : x > y ? -1 : a.i - b.i; })
        .map(function (p) { return p.m; });
    }

    function get(id) {
      if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(store, id)) throw notFound();
      return store[id];
    }
    // A draft that was sent is gone from Drafts, as in Graph (404), so a retry after an ambiguous
    // send failure can tell it went out.
    var sentDrafts = {};
    function getDraft(id) {
      if (typeof id === 'string' && sentDrafts[id]) throw notFound();
      var d = get(id);
      if (!d.isDraft) throw badArg('not a draft');
      return d;
    }

    function newDraft(fields) {
      seq++;
      var id = 'demo-draft-' + seq;
      var t = new Date(now()).toISOString();
      var d = Object.assign({
        id: id, conversationId: 'demo-conv-new-' + seq, subject: '', bodyPreview: '',
        body: { contentType: 'html', content: '' },
        from: { emailAddress: { name: me.displayName, address: me.mail } },
        sender: { emailAddress: { name: me.displayName, address: me.mail } },
        toRecipients: [], ccRecipients: [], replyTo: [],
        createdDateTime: t, lastModifiedDateTime: t, receivedDateTime: t, sentDateTime: null,
        isRead: true, isDraft: true, importance: 'normal', flag: { flagStatus: 'notFlagged' },
        hasAttachments: false, inferenceClassification: 'focused', internetMessageHeaders: [],
        parentFolderId: 'drafts', webLink: ''
      }, fields);
      d.bodyPreview = previewOf(d.body.content);
      store[id] = d;
      order.push(id);
      return d;
    }

    // Every public call: simulated latency, then a deep copy out (callers never hold the store).
    function call(fn) {
      return function () {
        var args = arguments;
        return Promise.resolve(sleep(latency())).then(function () { return clone(fn.apply(null, args)); });
      };
    }

    return {
      isDemo: true,
      extras: function () { return clone(extras); },

      listMessages: call(function (o) {
        o = o || {};
        var folder = o.folder, offset = 0, top;
        if (o.skipToken != null) {
          var p = /^demo:([^:]+):(\d+):(\d+)$/.exec(String(o.skipToken));
          if (!p) throw badArg('skipToken');
          folder = p[1]; offset = Number(p[2]); top = Number(p[3]);
        } else {
          top = Math.max(1, Math.min(MAX_TOP, Math.floor(Number(o.top) || MAX_TOP)));
        }
        if (typeof folder !== 'string' || !folderKnown(folder)) throw notFound();
        var all = sorted(function (m) { return m.parentFolderId === folder; });
        var page = all.slice(offset, offset + top);
        var end = offset + page.length;
        return { items: page.map(listView), next: end < all.length ? 'demo:' + folder + ':' + end + ':' + top : null };
      }),

      getMessage: call(function (id) { return get(id); }),

      listAttachments: call(function (id) {
        get(id);
        return (attachments[id] || []).map(function (a) {
          return { id: a.id, name: a.name, size: a.size, contentType: a.contentType, isInline: !!a.isInline, contentId: a.contentId == null ? null : a.contentId };
        });
      }),

      getAttachmentBytes: function (id, attId) {
        return Promise.resolve(sleep(latency())).then(function () {
          get(id);
          var a = (attachments[id] || []).filter(function (x) { return x.id === attId; })[0];
          if (!a) throw notFound();
          return decodeBase64(a.contentBytes);
        });
      },

      search: call(function (query) {
        var s = typeof query === 'string' ? query.replace(/"/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() : '';
        if (!s) throw badArg('query');
        var terms = s.split(' ');
        return sorted(function (m) {
          if (m.isDraft || m.parentFolderId === 'drafts') return false;
          var people = [m.from].concat(m.toRecipients || [], m.ccRecipients || []).map(function (r) {
            return r && r.emailAddress ? (r.emailAddress.name || '') + ' ' + (r.emailAddress.address || '') : '';
          }).join(' ');
          var hay = [m.subject, m.bodyPreview, people].join(' ').toLowerCase();
          return terms.every(function (t) { return hay.indexOf(t) !== -1; });
        }).slice(0, SEARCH_CAP).map(listView);
      }),

      patchMessage: call(function (id, patch) {
        var m = get(id);
        patch = patch || {};
        var changes = {};
        if (typeof patch.isRead === 'boolean') changes.isRead = patch.isRead;
        if (patch.flag !== undefined) changes.flag = flagOf(patch.flag);
        if (!Object.keys(changes).length) throw badArg('patch');
        Object.assign(m, changes);
        return m;
      }),

      move: call(function (id, destination) {
        var m = get(id);
        if (typeof destination !== 'string' || destination === 'drafts' || !folderKnown(destination)) throw notFound();
        m.parentFolderId = destination;
        return m;
      }),

      createReply: call(function (id, o) {
        var src = get(id);
        var to = (src.replyTo && src.replyTo.length) ? src.replyTo : [src.from];
        var cc = [];
        if (o && o.all) {
          var seen = {};
          to.forEach(function (r) { seen[addrOf(r).toLowerCase()] = 1; });
          cc = (src.toRecipients || []).concat(src.ccRecipients || []).filter(function (r) {
            var a = addrOf(r).toLowerCase();
            if (!a || a === myAddr || seen[a]) return false;
            seen[a] = 1;
            return true;
          });
        }
        to = to.filter(function (r) { return addrOf(r).toLowerCase() !== myAddr; });
        var fromA = src.from && src.from.emailAddress ? src.from.emailAddress : {};
        var quoted = '<div><br></div><hr><div id="divRplyFwdMsg"><b>From:</b> ' + escapeHtml(fromA.name || '') +
          ' &lt;' + escapeHtml(fromA.address || '') + '&gt;<br><b>Sent:</b> ' + escapeHtml(when(src)) +
          '<br><b>Subject:</b> ' + escapeHtml(src.subject || '') + '</div><div>' +
          (src.body && src.body.content ? src.body.content : '') + '</div>';
        return newDraft({
          conversationId: src.conversationId,
          subject: /^re:/i.test(src.subject || '') ? src.subject : 'RE: ' + (src.subject || ''),
          toRecipients: clone(to), ccRecipients: clone(cc),
          body: { contentType: 'html', content: quoted }
        });
      }),

      patchDraft: call(function (draftId, patch) {
        var d = getDraft(draftId);
        patch = patch || {};
        var changes = {};
        if (typeof patch.bodyHtml === 'string') changes.body = { contentType: 'html', content: patch.bodyHtml };
        if (typeof patch.subject === 'string') changes.subject = patch.subject.slice(0, 300);
        if (patch.toRecipients !== undefined) changes.toRecipients = recipients(patch.toRecipients);
        if (patch.ccRecipients !== undefined) changes.ccRecipients = recipients(patch.ccRecipients);
        if (!Object.keys(changes).length) throw badArg('patch');
        Object.assign(d, changes);
        d.bodyPreview = previewOf(d.body && d.body.content);
        d.lastModifiedDateTime = new Date(now()).toISOString();
        return d;
      }),

      sendDraft: function (draftId) {
        return Promise.resolve(sleep(latency())).then(function () {
          var d = getDraft(draftId);
          if (!(d.toRecipients || []).length && !(d.ccRecipients || []).length) {
            throw demoError(400, 'ErrorInvalidRecipients', 'no recipients');
          }
          var t = new Date(now()).toISOString();
          d.isDraft = false;
          sentDrafts[draftId] = true;
          d.isRead = true;
          d.parentFolderId = 'sentitems';
          d.from = { emailAddress: { name: me.displayName, address: me.mail } };
          d.sender = clone(d.from);
          d.sentDateTime = t;
          d.receivedDateTime = t;
          return undefined;
        });
      },

      createDraft: call(function (o) {
        o = o || {};
        return newDraft({
          subject: typeof o.subject === 'string' ? o.subject.slice(0, 300) : '',
          toRecipients: o.to == null || (Array.isArray(o.to) && !o.to.length) ? [] : recipients(o.to),
          body: { contentType: 'html', content: typeof o.bodyHtml === 'string' ? o.bodyHtml : '' }
        });
      }),

      calendarView: call(function (startIso, endIso) {
        if (!ISO_RE.test(String(startIso)) || !ISO_RE.test(String(endIso))) throw badArg('window');
        var a = Date.parse(startIso), b = Date.parse(endIso);
        function ms(dt) { return Date.parse(/(Z|[+-]\d{2}:\d{2})$/.test(dt) ? dt : String(dt).replace(/(\.\d{3})\d*$/, '$1') + 'Z'); }
        return calendar.filter(function (ev) {
          return ev.start && ev.end && ms(ev.start.dateTime) < b && ms(ev.end.dateTime) > a;
        }).sort(function (x, y) { return ms(x.start.dateTime) - ms(y.start.dateTime); });
      }),

      me: call(function () { return me; }),

      // Every message in a conversation (drafts excluded), like Graph's $filter=conversationId.
      listConversation: call(function (conversationId) {
        if (typeof conversationId !== 'string' || !conversationId) throw badArg('conversationId');
        return sorted(function (m) { return m.conversationId === conversationId && !m.isDraft; }).slice(0, 50).map(listView);
      })
    };
  }

  // ── Demo drafts ────────────────────────────────────────────────────────────
  // The demo has no model, so it picks a written draft for the email and stance (fixture
  // drafts.byId), and turns a one-line instruction into an email sentence. Real drafts come
  // from the vale-draft API.

  var VERB_S = /^(works|suits|fits|helps|sounds|makes|looks|matters|needs|wants)$/i;
  var AUX_W = /^(is|are|can|could|would|will|should|has|have|does|do|did|was|were)$/i;
  var PRONOUN = /^(he|she|they|him|her|them)$/i;

  function capital(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function sentence(s) {
    s = String(s || '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    s = capital(s);
    return /[.!?]$/.test(s) ? s : s + '.';
  }

  // "Tuesday works for a demo" → "Does Tuesday work for a demo?"; "he can send it" → "Can you send it?"
  function askQuestion(clause, name) {
    var w = String(clause || '').trim().replace(/[.?!]+$/, '').split(/\s+/).filter(Boolean);
    function who(words) {
      var s = words.join(' ');
      return PRONOUN.test(s) || (name && s.toLowerCase() === String(name).toLowerCase()) ? 'you' : s;
    }
    for (var i = 1; i < w.length; i++) {
      var rest = w.length > i + 1 ? ' ' + w.slice(i + 1).join(' ') : '';
      var subj = who(w.slice(0, i));
      if (VERB_S.test(w[i])) return (subj === 'you' ? 'Do you ' : 'Does ' + subj + ' ') + w[i].replace(/s$/i, '') + rest + '?';
      if (AUX_W.test(w[i])) {
        var aux = w[i].toLowerCase();
        if (subj === 'you') aux = { is: 'are', was: 'were', has: 'have', does: 'do' }[aux] || aux;
        return capital(aux) + ' ' + subj + rest + '?';
      }
    }
    return 'Could you let me know if ' + w.join(' ') + '?';
  }

  function rewriteInstruction(text, name) {
    var s = String(text || '').trim().replace(/\s+/g, ' ');
    var m;
    if ((m = /^ask\s+(\S+)\s+(?:if|whether)\s+(.+)$/i.exec(s))) return askQuestion(m[2], m[1]);
    if ((m = /^ask\s+(\S+)\s+to\s+(.+)$/i.exec(s))) return 'Could you ' + m[2].replace(/[.?!]+$/, '') + '?';
    if ((m = /^ask\s+(\S+)\s+for\s+(.+)$/i.exec(s))) return 'Could you send me ' + m[2].replace(/[.?!]+$/, '') + '?';
    if ((m = /^ask\s+(\S+)\s+about\s+(.+)$/i.exec(s))) return 'Could you tell me more about ' + m[2].replace(/[.?!]+$/, '') + '?';
    if ((m = /^let\s+(\S+)\s+know\s+(?:that\s+)?(.+)$/i.exec(s)) || (m = /^tell\s+(\S+)\s+(?:that\s+)?(.+)$/i.exec(s))) {
      var body = m[2].replace(new RegExp('^(?:he|she|they|' + m[1].replace(/[^\w-]/g, '') + ')\\b', 'i'), 'you');
      return sentence(body);
    }
    if ((m = /^(?:say|reply|answer|respond)(?:\s+(?:that|with))?\s+(.+)$/i.exec(s))) return sentence(m[1]);
    return sentence(s);
  }

  // o: { id, stance, instruction, option, firstName, mismatch }
  function demoDraft(drafts, o) {
    var d = drafts || {};
    o = o || {};
    var by = (d.byId && d.byId[o.id]) || {};
    function fill(t, ins) {
      return String(t || d['default'] || '').replace(/\{firstName\}/g, String(o.firstName || '').trim() || 'there')
        .replace(/\{instruction\}/g, ins || '');
    }
    // A mismatched Reply-To never gets agreement, whatever was pressed or typed.
    if (o.mismatch || o.stance === 'verify') return fill(d.verify);
    if (o.stance === 'choice') return fill(by.choice || d.choice, String(o.option || '').trim());
    if (o.instruction) return fill(d.compose, rewriteInstruction(o.instruction, o.firstName));
    var key = o.stance || 'answer';
    return fill(by[key] || d[key]);
  }

  var _exports = { createDemoGraph: createDemoGraph, shiftIso: shiftIso, rewriteInstruction: rewriteInstruction, demoDraft: demoDraft, previewOf: previewOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
  else if (root) root.ValeMailDemo = _exports;
})(typeof window !== 'undefined' ? window : this);
