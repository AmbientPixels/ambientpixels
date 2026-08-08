#!/usr/bin/env node
// Registers the /roast slash command with Discord. Run ONCE after creating the
// application, and again only if the command's name or description changes.
//
//   DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... node scripts/register-discord-commands.js
//
// Global commands can take up to an hour to appear. To test immediately, pass a
// guild id and it registers there instead, which is instant:
//
//   ... DISCORD_GUILD_ID=<your test server> node scripts/register-discord-commands.js
//
// The bot token is only needed HERE. The interactions endpoint itself never uses
// it — followups are authenticated by the per-interaction token Discord sends.

const APP_ID = process.env.DISCORD_APPLICATION_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!APP_ID || !TOKEN) {
  console.error('Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN.');
  console.error('Both are on the Discord application page: https://discord.com/developers/applications');
  process.exit(1);
}

// No options on purpose. A slash command's option values are rendered into the
// channel for everyone, and a resume carries a name, email, phone and address —
// so the resume is collected by a modal the endpoint opens instead.
const COMMANDS = [{
  name: 'roast',
  description: 'Get your resume roasted — ATS score, the roast, and what you are missing. Free.',
  type: 1
}];

const url = GUILD_ID
  ? 'https://discord.com/api/v10/applications/' + APP_ID + '/guilds/' + GUILD_ID + '/commands'
  : 'https://discord.com/api/v10/applications/' + APP_ID + '/commands';

(async () => {
  const res = await fetch(url, {
    method: 'PUT',                       // PUT replaces the full set, so re-running is safe
    headers: { 'Content-Type': 'application/json', Authorization: 'Bot ' + TOKEN },
    body: JSON.stringify(COMMANDS)
  });
  const body = await res.text();
  if (!res.ok) {
    console.error('Registration failed: HTTP ' + res.status);
    console.error(body);
    process.exit(1);
  }
  console.log('Registered ' + COMMANDS.length + ' command(s) ' + (GUILD_ID ? 'to guild ' + GUILD_ID + ' (instant)' : 'globally (up to 1h to appear)'));
  for (const c of JSON.parse(body)) console.log('  /' + c.name + ' — ' + c.description);
})().catch(err => { console.error(err.message); process.exit(1); });
