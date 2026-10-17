// graph.js — read-only Microsoft Graph client for Vale (delegated token). Injected fetch so
// every path is testable offline. Retries 429/5xx honoring Retry-After; pages with a hard cap.
'use strict';

var BASE = 'https://graph.microsoft.com/v1.0';
var MAX_RETRIES = 3;

var INBOX_SELECT = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,importance,flag,' +
  'inferenceClassification,bodyPreview,webLink,conversationId,internetMessageHeaders';
var SENT_SELECT = 'id,subject,toRecipients,sentDateTime,conversationId';
var EVENT_SELECT = 'id,subject,start,end,location,attendees,organizer,isOnlineMeeting,responseStatus,isCancelled,isOrganizer';

class GraphError extends Error { constructor(status, msg) { super('graph ' + status + ': ' + msg); this.name = 'GraphError'; this.status = status; } }

// deps: { fetch, token, sleep? }
function createGraph(deps) {
  var sleep = deps.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var calls = 0;

  async function get(urlOrPath, headers) {
    var url = /^https:\/\//.test(urlOrPath) ? urlOrPath : BASE + urlOrPath;
    if (url.indexOf(BASE + '/') !== 0) throw new GraphError(0, 'refusing non-Graph URL');
    for (var attempt = 0; ; attempt++) {
      calls++;
      var r = await deps.fetch(url, { headers: Object.assign({ Authorization: 'Bearer ' + deps.token }, headers || {}) });
      if ((r.status === 429 || r.status >= 500) && attempt < MAX_RETRIES) {
        var ra = Number(r.headers && r.headers.get && r.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) * 1000 : 1500 * (attempt + 1));
        continue;
      }
      var text = '';
      try { text = await r.text(); } catch (e) { text = ''; }
      var body = {};
      try { body = text ? JSON.parse(text) : {}; } catch (e) { body = {}; }
      if (!r.ok) throw new GraphError(r.status, (body.error && body.error.message) || text.slice(0, 160));
      return body;
    }
  }

  async function getPaged(path, cap, headers) {
    var out = [];
    var next = path;
    while (next && out.length < cap) {
      var page = await get(next, headers);
      out = out.concat(page.value || []);
      next = page['@odata.nextLink'] || null;
    }
    return out.slice(0, cap);
  }

  function q(params) { return Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&'); }

  return {
    calls: function () { return calls; },
    listInbox: function (sinceIso, cap) {
      return getPaged('/me/mailFolders/inbox/messages?' + q({
        '$select': INBOX_SELECT, '$filter': 'receivedDateTime ge ' + sinceIso, '$orderby': 'receivedDateTime desc', '$top': 50
      }), cap || 200);
    },
    listSent: function (sinceIso, cap) {
      return getPaged('/me/mailFolders/sentitems/messages?' + q({
        '$select': SENT_SELECT, '$filter': 'sentDateTime ge ' + sinceIso, '$orderby': 'sentDateTime desc', '$top': 50
      }), cap || 200);
    },
    calendarView: function (startIso, endIso) {
      return getPaged('/me/calendarView?' + q({
        startDateTime: startIso, endDateTime: endIso, '$select': EVENT_SELECT, '$orderby': 'start/dateTime', '$top': 50
      }), 100, { Prefer: 'outlook.timezone="Pacific Standard Time"' });
    }
  };
}

module.exports = { createGraph: createGraph, GraphError: GraphError, INBOX_SELECT: INBOX_SELECT };
