// Vale Mail — Microsoft Graph client for the browser (delegated MSAL token).
//
// Runs in the browser (window.ValeGraphBrowser) and under node tests (module.exports).
// One interface shared with the demo backend (vale-mail-demo.js), see METHODS.
// - Every request: Authorization: Bearer <getToken()>, Prefer: IdType="ImmutableId"
//   (ids survive archive moves); extra preferences go in the same Prefer header.
// - Retries 429 (always) and 5xx (reads and PATCH only — a POST such as send or createReply
//   may already have happened, so it is never repeated on a 5xx) up to 3 times, honouring
//   Retry-After capped at 10 s. A 401 asks getToken({forceRefresh:true}) once.
// - Only https://graph.microsoft.com/v1.0/ URLs are ever fetched (next links are checked).
// - Every fetch has a timeout (30 s; 60 s for a send). A hung request rejects with
//   GraphError(0, 'timeout') instead of leaving the page waiting forever.
// - parentFolderId comes back from Graph as an opaque id; it is normalised to the well-known
//   name ('inbox', 'sentitems', 'archive', 'drafts') so the UI can compare it, like the demo.
// Plan: docs/superpowers/plans/2026-10-17-vale-mail-overnight.md (Task 4).

(function (root) {
  'use strict';

  var BASE = 'https://graph.microsoft.com/v1.0';
  var MAX_RETRIES = 3;
  var MAX_WAIT_MS = 10000;
  var IMMUTABLE = 'IdType="ImmutableId"';
  var MAX_TOP = 50;
  var SEARCH_CAP = 50;
  var ATTACH_CAP = 100;
  var CALENDAR_CAP = 100;
  var CONVERSATION_CAP = 50;
  var TIMEOUT_MS = 30000;
  var SEND_TIMEOUT_MS = 60000;
  var WELL_KNOWN = ['inbox', 'sentitems', 'archive', 'drafts'];

  var LIST_SELECT = 'id,conversationId,subject,bodyPreview,from,sender,toRecipients,ccRecipients,replyTo,' +
    'receivedDateTime,sentDateTime,isRead,isDraft,importance,flag,hasAttachments,inferenceClassification,' +
    'internetMessageHeaders,parentFolderId,webLink';
  var FULL_SELECT = LIST_SELECT + ',body';
  var EVENT_SELECT = 'id,subject,start,end,isAllDay,showAs,location,isOnlineMeeting,onlineMeeting,organizer,' +
    'attendees,responseStatus,isCancelled,isOrganizer';
  var METHODS = ['listMessages', 'getMessage', 'listAttachments', 'getAttachmentBytes', 'search', 'patchMessage',
    'move', 'createReply', 'patchDraft', 'sendDraft', 'createDraft', 'calendarView', 'me', 'listConversation'];
  var CONVERSATION_SELECT = 'id,conversationId,from,sender,toRecipients,ccRecipients,replyTo';
  var FLAG_STATUSES = ['flagged', 'notFlagged', 'complete'];
  var EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
  var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

  function GraphError(status, code, message) {
    var e = new Error('graph ' + status + (code ? ' ' + code : '') + (message ? ': ' + message : ''));
    e.name = 'GraphError';
    e.status = status;
    e.code = code || '';
    Object.setPrototypeOf(e, GraphError.prototype);
    return e;
  }
  GraphError.prototype = Object.create(Error.prototype);
  GraphError.prototype.constructor = GraphError;

  function argError(what) { return new GraphError(0, 'bad_arg', what); }

  function isGraphUrl(url) { return typeof url === 'string' && url.indexOf(BASE + '/') === 0; }

  function seg(id, what) {
    if (typeof id !== 'string' || !id) throw argError(what || 'id');
    return encodeURIComponent(id);
  }

  function q(params) {
    return Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  }

  function recipients(list, what) {
    var arr = Array.isArray(list) ? list : [list];
    return arr.map(function (r) {
      var address = typeof r === 'string' ? r : (r && r.emailAddress && r.emailAddress.address);
      address = typeof address === 'string' ? address.trim() : '';
      if (!EMAIL_RE.test(address)) throw argError(what || 'recipient');
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
    throw argError('flag');
  }

  function waitFor(r, attempt) {
    var ra = Number(r && r.headers && r.headers.get && r.headers.get('retry-after'));
    if (isFinite(ra) && ra > 0) return Math.min(ra * 1000, MAX_WAIT_MS);
    return Math.min(1000 * Math.pow(2, attempt), MAX_WAIT_MS);
  }

  // deps: { fetch, getToken(opts?) -> Promise<string>, sleep?, timeZone?, timeoutMs?, sendTimeoutMs? }
  function createGraphClient(deps) {
    deps = deps || {};
    if (typeof deps.fetch !== 'function') throw new Error('createGraphClient: fetch is required');
    if (typeof deps.getToken !== 'function') throw new Error('createGraphClient: getToken is required');
    var doFetch = deps.fetch;
    var sleep = deps.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var timeZone = typeof deps.timeZone === 'string' && deps.timeZone ? deps.timeZone : 'Pacific Standard Time';
    var timeoutMs = Number(deps.timeoutMs) > 0 ? Number(deps.timeoutMs) : TIMEOUT_MS;
    var sendTimeoutMs = Number(deps.sendTimeoutMs) > 0 ? Number(deps.sendTimeoutMs) : SEND_TIMEOUT_MS;

    // One fetch with a deadline: the AbortController cancels it, and the race rejects even if the
    // fetch ignores the signal.
    function timedFetch(url, init, ms) {
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      if (ctrl) init.signal = ctrl.signal;
      var timer;
      var deadline = new Promise(function (resolve, reject) {
        timer = setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) { /* ignore */ } } reject(new GraphError(0, 'timeout', 'request timed out')); }, ms);
      });
      var req = Promise.resolve().then(function () { return doFetch(url, init); });
      return Promise.race([req, deadline]).then(function (r) { clearTimeout(timer); return r; }, function (e) {
        clearTimeout(timer);
        if (e && e.name === 'GraphError') throw e;
        throw new GraphError(0, 'network', 'network error');
      });
    }

    // opts: { method, body, prefer, raw }
    async function request(pathOrUrl, opts) {
      opts = opts || {};
      var method = opts.method || 'GET';
      var url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : BASE + pathOrUrl;
      if (!isGraphUrl(url)) throw new GraphError(0, 'bad_url', 'refusing non-Graph URL');
      var retry5xx = method === 'GET' || method === 'PATCH';
      var ms = opts.timeoutMs || timeoutMs;
      var refreshed = false;
      var token = await deps.getToken();
      for (var attempt = 0; ; attempt++) {
        if (typeof token !== 'string' || !token) throw new GraphError(0, 'no_token', 'not signed in');
        var headers = { Authorization: 'Bearer ' + token, Prefer: opts.prefer ? IMMUTABLE + ', ' + opts.prefer : IMMUTABLE };
        var init = { method: method, headers: headers };
        if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
        var r = await timedFetch(url, init, ms);
        if (r.status === 401 && !refreshed) {
          refreshed = true;
          token = await deps.getToken({ forceRefresh: true });
          attempt--;
          continue;
        }
        if ((r.status === 429 || (r.status >= 500 && retry5xx)) && attempt < MAX_RETRIES) {
          await sleep(waitFor(r, attempt));
          continue;
        }
        if (r.ok && opts.raw) return r.arrayBuffer();
        var text = '';
        try { text = await r.text(); } catch (e2) { text = ''; }
        var body = {};
        try { body = text ? JSON.parse(text) : {}; } catch (e3) { body = {}; }
        if (!r.ok) {
          var err = (body && body.error) || {};
          throw new GraphError(r.status, typeof err.code === 'string' ? err.code : '', typeof err.message === 'string' ? err.message.slice(0, 200) : '');
        }
        return body && typeof body === 'object' ? body : {};
      }
    }

    async function paged(path, cap, prefer) {
      var out = [];
      var next = path;
      while (next && out.length < cap) {
        var page = await request(next, { prefer: prefer });
        out = out.concat(Array.isArray(page.value) ? page.value : []);
        next = isGraphUrl(page['@odata.nextLink']) ? page['@odata.nextLink'] : null;
      }
      return out.slice(0, cap);
    }

    // Well-known folder ids, looked up once per client (in parallel) and cached.
    var folderIds = null;
    function wellKnownIds() {
      if (!folderIds) {
        folderIds = Promise.all(WELL_KNOWN.map(function (name) {
          return request('/me/mailFolders/' + name + '?' + q({ '$select': 'id' })).then(function (f) { return f && f.id; }, function () { return null; });
        })).then(function (ids) {
          var map = {};
          ids.forEach(function (id, i) { if (typeof id === 'string' && id) map[id] = WELL_KNOWN[i]; });
          // Nothing resolved (offline, say): look again next time rather than caching a blank.
          if (!Object.keys(map).length) folderIds = null;
          return map;
        });
      }
      return folderIds;
    }
    async function normalise(msgs) {
      var list = Array.isArray(msgs) ? msgs : [msgs];
      if (!list.some(function (m) { return m && typeof m.parentFolderId === 'string' && WELL_KNOWN.indexOf(m.parentFolderId) === -1; })) return msgs;
      var map = await wellKnownIds();
      list.forEach(function (m) {
        if (m && typeof m.parentFolderId === 'string' && Object.prototype.hasOwnProperty.call(map, m.parentFolderId)) m.parentFolderId = map[m.parentFolderId];
      });
      return msgs;
    }

    return {
      isDemo: false,

      listMessages: async function (opts) {
        opts = opts || {};
        var url;
        if (opts.skipToken != null) {
          if (!isGraphUrl(opts.skipToken)) throw new GraphError(0, 'bad_url', 'refusing non-Graph URL');
          url = opts.skipToken;
        } else {
          var top = Math.max(1, Math.min(MAX_TOP, Math.floor(Number(opts.top) || MAX_TOP)));
          url = '/me/mailFolders/' + seg(opts.folder, 'folder') + '/messages?' +
            q({ '$select': LIST_SELECT, '$orderby': 'receivedDateTime desc', '$top': top });
        }
        var page = await request(url);
        var items = Array.isArray(page.value) ? page.value : [];
        await normalise(items);
        return {
          items: items,
          next: isGraphUrl(page['@odata.nextLink']) ? page['@odata.nextLink'] : null
        };
      },

      getMessage: async function (id) {
        var m = await request('/me/messages/' + seg(id) + '?' + q({ '$select': FULL_SELECT }), { prefer: 'outlook.body-content-type="html"' });
        return normalise(m);
      },

      // Every message in a conversation (who was in it), for the client-thread check. Graph
      // rejects $orderby with this $filter, so none is asked for.
      listConversation: async function (conversationId) {
        if (typeof conversationId !== 'string' || !conversationId) throw argError('conversationId');
        return paged('/me/messages?' + q({
          '$filter': "conversationId eq '" + conversationId.replace(/'/g, "''") + "'", '$select': CONVERSATION_SELECT, '$top': CONVERSATION_CAP
        }), CONVERSATION_CAP);
      },

      listAttachments: async function (id) {
        var list = await paged('/me/messages/' + seg(id) + '/attachments', ATTACH_CAP);
        return list.map(function (a) {
          return {
            id: a.id, name: a.name, size: a.size, contentType: a.contentType,
            isInline: !!a.isInline, contentId: a.contentId == null ? null : a.contentId
          };
        });
      },

      getAttachmentBytes: async function (id, attId) {
        return request('/me/messages/' + seg(id) + '/attachments/' + seg(attId, 'attachment id') + '/$value', { raw: true });
      },

      search: function (query) {
        var s = typeof query === 'string' ? query.replace(/"/g, ' ').replace(/\s+/g, ' ').trim() : '';
        if (!s) return Promise.reject(argError('query'));
        return paged('/me/messages?' + q({ '$search': '"' + s + '"', '$select': LIST_SELECT, '$top': 25 }), SEARCH_CAP).then(normalise);
      },

      patchMessage: function (id, patch) {
        try {
          var body = {};
          patch = patch || {};
          if (typeof patch.isRead === 'boolean') body.isRead = patch.isRead;
          if (patch.flag !== undefined) body.flag = flagOf(patch.flag);
          if (!Object.keys(body).length) throw argError('patch');
          return request('/me/messages/' + seg(id), { method: 'PATCH', body: body });
        } catch (e) { return Promise.reject(e); }
      },

      move: function (id, destination) {
        try {
          if (typeof destination !== 'string' || !destination) throw argError('destination');
          return request('/me/messages/' + seg(id) + '/move', { method: 'POST', body: { destinationId: destination } }).then(normalise);
        } catch (e) { return Promise.reject(e); }
      },

      createReply: function (id, opts) {
        try {
          return request('/me/messages/' + seg(id) + (opts && opts.all ? '/createReplyAll' : '/createReply'), { method: 'POST', body: {} });
        } catch (e) { return Promise.reject(e); }
      },

      patchDraft: function (draftId, patch) {
        try {
          var body = {};
          patch = patch || {};
          if (typeof patch.bodyHtml === 'string') body.body = { contentType: 'html', content: patch.bodyHtml };
          if (typeof patch.subject === 'string') body.subject = patch.subject.slice(0, 300);
          if (patch.toRecipients !== undefined) body.toRecipients = recipients(patch.toRecipients, 'toRecipients');
          if (patch.ccRecipients !== undefined) body.ccRecipients = recipients(patch.ccRecipients, 'ccRecipients');
          if (!Object.keys(body).length) throw argError('patch');
          return request('/me/messages/' + seg(draftId, 'draft id'), { method: 'PATCH', body: body });
        } catch (e) { return Promise.reject(e); }
      },

      sendDraft: async function (draftId) {
        await request('/me/messages/' + seg(draftId, 'draft id') + '/send', { method: 'POST', timeoutMs: sendTimeoutMs });
        return undefined;
      },

      createDraft: function (opts) {
        try {
          opts = opts || {};
          var body = {
            subject: typeof opts.subject === 'string' ? opts.subject.slice(0, 300) : '',
            body: { contentType: 'html', content: typeof opts.bodyHtml === 'string' ? opts.bodyHtml : '' },
            toRecipients: opts.to == null || (Array.isArray(opts.to) && !opts.to.length) ? [] : recipients(opts.to, 'to')
          };
          return request('/me/messages', { method: 'POST', body: body });
        } catch (e) { return Promise.reject(e); }
      },

      calendarView: function (startIso, endIso) {
        if (!ISO_RE.test(String(startIso)) || !ISO_RE.test(String(endIso))) return Promise.reject(argError('window'));
        return paged('/me/calendarView?' + q({
          startDateTime: startIso, endDateTime: endIso, '$select': EVENT_SELECT, '$orderby': 'start/dateTime', '$top': 50
        }), CALENDAR_CAP, 'outlook.timezone="' + timeZone.replace(/"/g, '') + '"');
      },

      me: async function () {
        var u = await request('/me?' + q({ '$select': 'displayName,mail,userPrincipalName' }));
        return { displayName: u.displayName || '', mail: u.mail || u.userPrincipalName || '' };
      }
    };
  }

  var _exports = {
    createGraphClient: createGraphClient, GraphError: GraphError, METHODS: METHODS, BASE: BASE,
    LIST_SELECT: LIST_SELECT, FULL_SELECT: FULL_SELECT
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
  else if (root) root.ValeGraphBrowser = _exports;
})(typeof window !== 'undefined' ? window : this);
