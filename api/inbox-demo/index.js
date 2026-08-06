// inbox-demo — server side of the inbox triage proof of concept.
//
// Reads a mailbox via Microsoft Graph and classifies each message, so the demo
// can be driven from a browser instead of a laptop terminal. Read-only: this
// never moves, marks, or deletes anything. The Graph app registration behind it
// holds delegated Mail.Read and nothing else, so there is no write path to abuse.
//
// TWO GATES, because this reads a real personal mailbox:
//   1. x-company-secret (now genuinely enforced -- see _utils/ceoSecret.js)
//   2. the page that calls it lives under /modules/company/, which
//      staticwebapp.config.json restricts to authenticated users
//
// The refresh token is stored in blob under a key that is deliberately NOT in
// company-state's VALID_KEYS, so it is unreachable through the public state API
// (same approach as pingLog). Microsoft rotates refresh tokens on use, so every
// refresh writes the new one back or the next call would fail.
const storage = require('../_utils/companyStorage');
const { isValidCeoSecret } = require('../_utils/ceoSecret');

const TOKEN_KEY = 'inboxDemoToken';
const LAST_RUN_KEY = 'inboxDemoLastRun';
const CLIENT_ID = '894d8c2e-e2ad-40a8-a0a6-5a0b68b9979d';
const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPES = 'Mail.Read User.Read offline_access';
const MODEL = process.env.INBOX_DEMO_MODEL || 'claude-haiku-4-5-20251001';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret'
};

const CATEGORIES = `
- needs_you       a person is waiting on a reply, a decision, or an action from you
- transactional   receipts, confirmations, security and account notices. keep, but nothing to do
- promotional     sales, offers, discount codes, marketing from companies
- newsletter      subscriptions and digests you signed up for`.trim();

async function refreshAccessToken() {
  const saved = (await storage.getState(TOKEN_KEY)) || {};
  if (!saved.refresh_token) {
    const e = new Error('no refresh token stored — seed it once from the local spike');
    e.status = 409;
    throw e;
  }
  const r = await fetch(AUTHORITY + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: saved.refresh_token,
      scope: SCOPES
    }).toString()
  });
  const t = await r.json();
  if (!t.access_token) {
    const e = new Error('token refresh failed: ' + (t.error_description || t.error || 'unknown'));
    e.status = 401;
    throw e;
  }
  // Rotated on every use — persist immediately or the next run is locked out.
  if (t.refresh_token) {
    await storage.setState(TOKEN_KEY, { refresh_token: t.refresh_token, updatedAt: new Date().toISOString() });
  }
  return t.access_token;
}

async function graph(token, url, attempt = 1) {
  const r = await fetch('https://graph.microsoft.com/v1.0' + url, { headers: { Authorization: 'Bearer ' + token } });
  if ((r.status >= 500 || r.status === 429) && attempt < 4) {
    // Graph 504s readily on consumer mailboxes, especially on a cold token.
    await new Promise(s => setTimeout(s, attempt * 1500));
    return graph(token, url, attempt + 1);
  }
  const body = await r.text();
  let j = {};
  try { j = body ? JSON.parse(body) : {}; } catch (e) { /* non-JSON error body */ }
  if (!r.ok) {
    const err = new Error('graph ' + r.status + ': ' + ((j.error && j.error.message) || body.slice(0, 160)));
    err.status = 502;
    throw err;
  }
  return j;
}

async function classify(msgs) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error('ANTHROPIC_API_KEY not configured'); e.status = 500; throw e; }

  const prompt = `You are triaging an inbox. For each message decide one category:
${CATEGORIES}

Judge by what the message asks of the reader, not by who sent it. A real person
asking a question is needs_you even from an unknown address. A company sending a
discount is promotional even if the reader likes that company. Security alerts are
transactional unless they report something the reader must act on right now.

Return ONLY a JSON object:
{"summary":"2-3 sentences","items":[{"i":0,"category":"promotional","confidence":0.0,"why":"under 12 words"}]}

The summary is spoken to the mailbox owner, in plain language, the way a good
assistant would open the day. Lead with what needs them and who it is from. Then
one line on what the rest was. No preamble, no restating the categories, no
numbers they can already see on screen. Never invent anything not in the messages.

Messages:
${msgs.map((m, i) => {
    const f = (m.from && m.from.emailAddress) || {};
    return '[' + i + '] from: ' + (f.name || '') + ' <' + (f.address || '') + '>\nsubject: ' +
      (m.subject || '(none)') + '\npreview: ' + String(m.bodyPreview || '').replace(/\s+/g, ' ').slice(0, 200);
  }).join('\n\n')}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  if (!r.ok) { const e = new Error('classify failed: ' + JSON.stringify(j).slice(0, 200)); e.status = 502; throw e; }

  const text = (j.content || []).map(c => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) { const e = new Error('classifier returned no JSON object'); e.status = 502; throw e; }
  const parsed = JSON.parse(m[0]);

  const usage = j.usage || {};
  const cost = ((usage.input_tokens || 0) / 1e6) * 1.00 + ((usage.output_tokens || 0) / 1e6) * 5.00;
  return { verdicts: parsed.items || [], summary: String(parsed.summary || ''), cost };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS, body: '' }; return; }

  if (!isValidCeoSecret(req.headers['x-company-secret'])) {
    context.res = { status: 403, headers: CORS, body: { error: 'CEO access required' } };
    return;
  }

  const body = req.body || {};
  try {
    // One-time setup: hand it the refresh token minted by the local device-code flow.
    if (body.action === 'seed') {
      if (!body.refresh_token) throw Object.assign(new Error('refresh_token required'), { status: 400 });
      await storage.setState(TOKEN_KEY, { refresh_token: body.refresh_token, updatedAt: new Date().toISOString() });
      context.res = { status: 200, headers: CORS, body: { ok: true, seeded: true } };
      return;
    }

    const count = Math.max(1, Math.min(50, Number(body.count) || 25));
    const started = Date.now();

    const token = await refreshAccessToken();
    const me = await graph(token, '/me');
    const res = await graph(token,
      '/me/mailFolders/inbox/messages?$top=' + count +
      '&$orderby=receivedDateTime desc&$select=subject,from,receivedDateTime,bodyPreview,isRead,webLink');

    const messages = res.value || [];
    const { verdicts, summary, cost } = await classify(messages);

    const payload = {
      ok: true,
      account: me.displayName || me.userPrincipalName || '',
      summary,
      messages: messages.map(m => {
        const ea = (m.from && m.from.emailAddress) || {};
        return {
          subject: m.subject || '',
          from: ea.name || ea.address || '',
          // Address and webLink drive the Open / Reply buttons. Both are plain
          // navigation into Outlook — the agent never composes or sends.
          address: ea.address || '',
          webLink: m.webLink || '',
          receivedDateTime: m.receivedDateTime,
          bodyPreview: String(m.bodyPreview || '').replace(/\s+/g, ' ').slice(0, 160)
        };
      }),
      verdicts,
      stats: { count: messages.length, ms: Date.now() - started, costUsd: Number(cost.toFixed(5)) }
    };

    // Keep the last good run so a live failure degrades to real prior output
    // instead of an error box. Graph 504s on consumer mailboxes and tokens
    // expire; neither should end a demo. Non-fatal if the write fails.
    try {
      await storage.setState(LAST_RUN_KEY, Object.assign({ capturedAt: new Date().toISOString() }, payload));
    } catch (e) { context.log('[inbox-demo] cache write failed:', e.message); }

    context.res = { status: 200, headers: CORS, body: payload };
  } catch (e) {
    context.log('[inbox-demo]', e.message);

    // Fall back to the last good run, clearly labelled. Honest degradation:
    // the page says it is showing an earlier result, so nothing is misrepresented.
    try {
      const cached = await storage.getState(LAST_RUN_KEY);
      if (cached && cached.verdicts) {
        context.res = {
          status: 200,
          headers: CORS,
          body: Object.assign({}, cached, { stale: true, liveError: e.message })
        };
        return;
      }
    } catch (e2) { context.log('[inbox-demo] cache read failed:', e2.message); }

    context.res = { status: e.status || 500, headers: CORS, body: { ok: false, error: e.message } };
  }
};
