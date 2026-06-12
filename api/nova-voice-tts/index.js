// File: api/nova-voice-tts/index.js
// Nova Voice TTS — converts { text, mood } to mood-styled speech via Azure Speech REST.
// Spec: docs/superpowers/specs/2026-06-10-nova-voice-design.md

const { buildSsml } = require('./ssml');

const MAX_CHARS = 600; // cost guard — Azure free tier is 500K chars/month

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const jsonHeaders = { ...CORS, 'Content-Type': 'application/json' };

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS };
    return;
  }

  const key = process.env.SPEECH_KEY;
  const region = process.env.SPEECH_REGION;
  if (!key || !region) {
    context.log.error('[NovaVoiceTTS] SPEECH_KEY/SPEECH_REGION not configured');
    context.res = { status: 500, headers: jsonHeaders, body: { error: 'Voice not configured.' } };
    return;
  }

  const body = req.body || {};
  const text = (body.text || '').toString().trim();
  if (!text) {
    context.res = { status: 400, headers: jsonHeaders, body: { error: 'No text provided.' } };
    return;
  }
  if (text.length > MAX_CHARS) {
    context.res = { status: 400, headers: jsonHeaders, body: { error: `Text exceeds ${MAX_CHARS} character cap.` } };
    return;
  }

  const ssml = buildSsml(text, body.mood);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  try {
    const ttsRes = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'ambientpixels-nova-voice'
      },
      body: ssml,
      signal: ac.signal
    });

    if (!ttsRes.ok) {
      const detail = await ttsRes.text();
      context.log.error('[NovaVoiceTTS] Azure Speech error:', ttsRes.status, detail.substring(0, 300));
      context.res = { status: 502, headers: jsonHeaders, body: { error: 'Voice synthesis failed.', status: ttsRes.status } };
      return;
    }

    const audio = Buffer.from(await ttsRes.arrayBuffer());
    context.log('[NovaVoiceTTS] OK —', text.length, 'chars ->', audio.length, 'bytes');
    context.res = {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'audio/mpeg' },
      body: audio,
      isRaw: true
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      context.log.error('[NovaVoiceTTS] Azure Speech timeout (10s)');
      context.res = { status: 504, headers: jsonHeaders, body: { error: 'Voice synthesis timed out.' } };
      return;
    }
    context.log.error('[NovaVoiceTTS] Internal error:', err.message);
    context.res = { status: 500, headers: jsonHeaders, body: { error: 'Voice synthesis fault.' } };
  } finally {
    clearTimeout(timer);
  }
};
