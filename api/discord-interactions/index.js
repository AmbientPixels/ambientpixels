// discord-interactions — the Resume Roast Discord bot.
// POST /api/discord-interactions   (Discord calls this; never a browser)
//
// WHY THIS EXISTS: the share card is the product's only distribution mechanic
// that needs nobody's permission, and it only fires after someone has already
// found the site. A bot puts the same mechanic where job seekers already are:
// someone runs /roast in a server, a score appears in the channel, and everyone
// watching sees a number and wants their own.
//
// TWO DESIGN CONSTRAINTS SHAPE EVERYTHING HERE:
//
//  1. PRIVACY. Discord renders a slash command's option values into the channel,
//     so `/roast resume:<text>` would publish someone's name, email, phone and
//     address to the entire server. Input therefore comes through a MODAL, which
//     is private to the person typing. The public reply carries the score, the
//     verdict and two roast lines — never the document.
//
//  2. TIMING. Discord hangs up if it is not acknowledged within 3 seconds, and a
//     roast takes ~25. So every real answer is a DEFERRED ack followed by an
//     edit to the followup webhook.
//
// COST: this is a new public surface that spends per invocation, so it has a
// per-user daily cap AND a global daily cap. Without the global one, a single
// large server could drain the Anthropic balance in an afternoon.

const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');
const d = require('../_lib/discord/verify');
const { callModel, LlmUnavailableError } = require('../_lib/llm');
const fs = require('fs');
const path = require('path');

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const APP_ID = process.env.DISCORD_APPLICATION_ID;
const SITE = 'https://www.ambientpixels.ai/resume-roast/';

const PER_USER_DAILY = 3;
// A ceiling on what the whole bot can spend in a day, across every server.
const GLOBAL_DAILY = 300;
const STATE_KEY = 'discordRoastLimits';

let agentCache = null;
function resumeRoastAgent() {
  if (agentCache) return agentCache;
  const file = path.join(__dirname, '..', '_data', 'pixel-agents.json');
  agentCache = JSON.parse(fs.readFileSync(file, 'utf-8')).find(a => a.id === 'resume-roast');
  return agentCache;
}

function today() { return new Date().toISOString().split('T')[0]; }

// Returns null when allowed, or a message when not.
async function claimQuota(uid) {
  const day = today();
  let denial = null;
  await storage.mutateState(STATE_KEY, (current) => {
    const s = (current && current.day === day) ? current : { day, total: 0, users: {} };
    if (s.total >= GLOBAL_DAILY) {
      denial = 'The bot has hit its daily limit across all servers. Roast yours free on the site: ' + SITE;
      return undefined;                       // no write, nothing consumed
    }
    if ((s.users[uid] || 0) >= PER_USER_DAILY) {
      denial = 'That is ' + PER_USER_DAILY + ' roasts today. More on the site, free: ' + SITE;
      return undefined;
    }
    s.users[uid] = (s.users[uid] || 0) + 1;
    s.total += 1;
    return s;
  }).catch(() => { /* storage down: fail OPEN, one roast is cheaper than a dead bot */ });
  return denial;
}

// Discord followups are edited through the interaction token, which is valid for
// 15 minutes. No bot token needed for this call.
async function editFollowup(token, body) {
  const url = 'https://discord.com/api/v10/webhooks/' + APP_ID + '/' + token + '/messages/@original';
  return fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

module.exports = async function (context, req) {
  // Discord verifies the endpoint by sending deliberately-INVALID signatures and
  // requiring a 401. Anything else and it refuses to register the URL, so this
  // check is part of the handshake rather than defence in depth.
  const raw = typeof req.rawBody === 'string' ? req.rawBody : (req.rawBody ? String(req.rawBody) : '');
  const ok = d.verifyInteraction(
    raw,
    req.headers['x-signature-ed25519'],
    req.headers['x-signature-timestamp'],
    PUBLIC_KEY
  );
  if (!ok) {
    context.res = { status: 401, body: 'invalid request signature' };
    return;
  }

  let interaction;
  try { interaction = JSON.parse(raw); } catch { context.res = { status: 400, body: 'bad json' }; return; }

  const json = (obj, status) => {
    context.res = { status: status || 200, headers: { 'Content-Type': 'application/json' }, body: obj };
  };

  // Discord's liveness check.
  if (interaction.type === d.TYPE.PING) { json({ type: d.RESPONSE.PONG }); return; }

  // /roast -> open the private modal. No spend yet.
  if (interaction.type === d.TYPE.APPLICATION_COMMAND) {
    json(d.roastModal());
    return;
  }

  if (interaction.type !== d.TYPE.MODAL_SUBMIT) { json({ type: d.RESPONSE.PONG }); return; }

  const uid = d.userId(interaction) || 'unknown';
  const denial = await claimQuota(uid);
  if (denial) {
    json({ type: d.RESPONSE.CHANNEL_MESSAGE, data: { content: denial, flags: d.EPHEMERAL } });
    return;
  }

  const resume = d.modalValue(interaction, 'resume').trim();
  const job = d.modalValue(interaction, 'job').trim();
  if (resume.length < 200) {
    json({ type: d.RESPONSE.CHANNEL_MESSAGE, data: { content: 'That is too short to roast — paste the full resume text.', flags: d.EPHEMERAL } });
    return;
  }

  // ACK inside 3 seconds; the answer follows as an edit.
  json({ type: d.RESPONSE.DEFERRED_MESSAGE });

  // Deliberately not awaited before responding — Discord already has its ack.
  // Any throw in here must never escape, or the user is left with a permanent
  // "thinking…" and no explanation.
  const token = interaction.token;
  (async () => {
    const agent = resumeRoastAgent();
    try {
      const prompt = agent.userPromptTemplate.replace('{{input}}', resume)
        + (job ? '\n\n' + (agent.secondaryInput.promptLabel || 'TARGET JOB DESCRIPTION') + ':\n' + job : '');

      const llm = await callModel({
        model: 'claude-sonnet',
        system: agent.systemPrompt,
        prompt,
        maxTokens: agent.generationConfig.maxOutputTokens,
        temperature: agent.generationConfig.temperature,
        json: true,
        caller: 'discord-bot',
        agentId: 'resume-roast'
      });

      let result;
      let text = (llm.text || '').trim();
      if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      try { result = JSON.parse(text); } catch { result = null; }

      if (!result) {
        await editFollowup(token, { content: 'The roast came back malformed. Try again, or use the site: ' + SITE });
        return;
      }

      await editFollowup(token, {
        embeds: [d.resultEmbed(result, 'Resume Roast', SITE)],
        components: [{
          type: 1,
          components: [{ type: 2, style: 5, label: 'Roast yours — free', url: SITE }]
        }]
      });
    } catch (err) {
      const msg = (err instanceof LlmUnavailableError)
        ? 'Resume Roast is over capacity right now. Try again shortly, or use the site: ' + SITE
        : 'Something broke on our side. Try the site: ' + SITE;
      context.log.error('[discord] roast failed:', err.message);
      await editFollowup(token, { content: msg }).catch(() => {});
    }
  })().catch(err => context.log.error('[discord] followup failed:', err.message));
};
