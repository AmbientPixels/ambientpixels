// File: api/nova-voice-tts/index.js
// Nova Voice TTS — converts { text, mood } to mood-styled speech via Azure Speech REST.
// Spec: docs/superpowers/specs/2026-06-10-nova-voice-design.md

const { buildSsml } = require('./ssml');

const MAX_CHARS = 600; // cost guard — Azure free tier is 500K chars/month

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders };
    return;
  }

  const key = process.env.SPEECH_KEY;
  const region = process.env.SPEECH_REGION;
  if (!key || !region) {
    context.log.error('[NovaVoiceTTS] SPEECH_KEY/SPEECH_REGION not configured');
    context.res = { status: 500, headers: corsHeaders, body: { error: 'Voice not configured.' } };
    return;
  }

  const body = req.body || {};
  const text = (body.text || '').toString().trim();
  if (!text) {
    context.res = { status: 400, headers: corsHeaders, body: { error: 'No text provided.' } };
    return;
  }
  if (text.length > MAX_CHARS) {
    context.res = { status: 400, headers: corsHeaders, body: { error: `Text exceeds ${MAX_CHARS} character cap.` } };
    return;
  }

  const ssml = buildSsml(text, body.mood);

  try {
    const ttsRes = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'ambientpixels-nova-voice'
      },
      body: ssml
    });

    if (!ttsRes.ok) {
      const detail = await ttsRes.text();
      context.log.error('[NovaVoiceTTS] Azure Speech error:', ttsRes.status, detail.substring(0, 300));
      context.res = { status: 502, headers: corsHeaders, body: { error: 'Voice synthesis failed.', status: ttsRes.status } };
      return;
    }

    const audio = Buffer.from(await ttsRes.arrayBuffer());
    context.log('[NovaVoiceTTS] OK —', text.length, 'chars ->', audio.length, 'bytes');
    context.res = {
      status: 200,
      headers: Object.assign({ 'Content-Type': 'audio/mpeg' }, corsHeaders),
      body: audio,
      isRaw: true
    };
  } catch (err) {
    context.log.error('[NovaVoiceTTS] Internal error:', err.message);
    context.res = { status: 500, headers: corsHeaders, body: { error: 'Voice synthesis fault.', details: err.message } };
  }
};
