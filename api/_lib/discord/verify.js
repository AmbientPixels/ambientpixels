// _lib/discord/verify — Discord interaction signature checking, as pure functions.
//
// Discord signs every interaction request with Ed25519 and REQUIRES the endpoint
// to reject bad signatures with 401. It verifies this during setup by sending
// deliberately-invalid signatures: an endpoint that answers 200 to those is
// refused. So this is not optional hardening, it is part of the handshake.
//
// No dependency needed. Node verifies Ed25519 natively, but wants a DER
// SubjectPublicKeyInfo while Discord hands out a raw 32-byte hex key, so the
// key is wrapped with the fixed 12-byte prefix below.

const crypto = require('crypto');

// ASN.1 SPKI header for Ed25519: SEQUENCE { SEQUENCE { OID 1.3.101.112 }, BIT STRING }
const ED25519_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * @param {string} rawBody   - the EXACT bytes Discord sent, before any JSON parsing
 * @param {string} signature - X-Signature-Ed25519 header
 * @param {string} timestamp - X-Signature-Timestamp header
 * @param {string} publicKey - the app's public key, 64 hex chars
 * @returns {boolean}
 */
function verifyInteraction(rawBody, signature, timestamp, publicKey) {
  if (typeof rawBody !== 'string' || !signature || !timestamp || !publicKey) return false;
  // A malformed key or signature must read as "not verified", never as a throw
  // that a caller might turn into a 500 — Discord treats non-401 as a pass.
  if (!/^[0-9a-fA-F]{64}$/.test(publicKey)) return false;
  if (!/^[0-9a-fA-F]{128}$/.test(signature)) return false;

  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([ED25519_DER_PREFIX, Buffer.from(publicKey, 'hex')]),
      format: 'der',
      type: 'spki'
    });
    return crypto.verify(
      null,
      Buffer.from(timestamp + rawBody),
      key,
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

// ── interaction + response types we use ──
const TYPE = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MODAL_SUBMIT: 5
};

const RESPONSE = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  // ACK now, edit the message later. The roast takes ~25s and Discord hangs up
  // at 3, so every real answer goes out as a followup edit.
  DEFERRED_MESSAGE: 5,
  MODAL: 9
};

// Ephemeral = visible only to the person who ran the command.
const EPHEMERAL = 64;

/**
 * The modal that collects the resume.
 *
 * WHY A MODAL AND NOT A COMMAND OPTION: Discord renders a slash command's
 * option values into the channel for everyone to read. A resume carries a real
 * name, email, phone and address, so `/roast resume:<text>` would publish
 * someone's personal details to the whole server. Modal input is private to the
 * person typing it, and never appears in the channel.
 */
function roastModal() {
  return {
    type: RESPONSE.MODAL,
    data: {
      custom_id: 'roast_modal',
      title: 'Roast my resume',
      components: [
        {
          type: 1,
          components: [{
            type: 4,
            custom_id: 'resume',
            label: 'Paste your resume',
            style: 2,
            min_length: 200,
            max_length: 4000,
            required: true,
            placeholder: 'Paste the text of your resume. Nobody else in this server can see what you type here.'
          }]
        },
        {
          type: 1,
          components: [{
            type: 4,
            custom_id: 'job',
            label: 'Job description (optional)',
            style: 2,
            max_length: 1000,
            required: false,
            placeholder: 'Paste a posting and the score and keyword gap target that job.'
          }]
        }
      ]
    }
  };
}

/** Pull a submitted modal field out of the nested component array. */
function modalValue(interaction, customId) {
  const rows = (interaction && interaction.data && interaction.data.components) || [];
  for (const row of rows) {
    for (const c of (row.components || [])) {
      if (c && c.custom_id === customId) return typeof c.value === 'string' ? c.value : '';
    }
  }
  return '';
}

/** The Discord user id, which differs between guild and DM payloads. */
function userId(interaction) {
  if (!interaction) return null;
  if (interaction.member && interaction.member.user) return interaction.member.user.id;
  if (interaction.user) return interaction.user.id;
  return null;
}

/**
 * The public result message.
 *
 * Carries the score, the verdict and up to two roast lines — and NEVER the
 * resume or anything identifying. The whole point of posting publicly is that
 * everyone watching sees a number and wants their own; none of that needs the
 * document. This is the same viral mechanic as the share card, in a channel.
 */
function resultEmbed(result, agentName, siteUrl) {
  const score = pickScore(result);
  const verdict = typeof result.verdict === 'string' ? result.verdict : '';
  const roast = Array.isArray(result.roast_points) ? result.roast_points.slice(0, 2) : [];
  const gap = Array.isArray(result.keyword_gap) ? result.keyword_gap.slice(0, 8) : [];

  const fields = [];
  if (roast.length) {
    // 460, not 220. Discord allows 1024 per field; the first cut of this used
    // 220 and clipped both lines mid-word ("somehow avoided every pa…"), which
    // reads as broken rather than abbreviated — and threw away 579 characters
    // of headroom to do it. Two lines at 460 plus bullets and a newline is 923.
    fields.push({ name: 'The roast', value: roast.map(r => '• ' + truncate(String(r), 460)).join('\n').slice(0, 1024) });
  }
  if (gap.length) {
    fields.push({ name: 'Missing for this job', value: gap.map(k => '`' + String(k).slice(0, 40) + '`').join(' ').slice(0, 1024) });
  }

  return {
    title: score === null ? agentName : agentName + ': ' + score + '/100',
    description: verdict ? truncate(verdict, 380) : 'Your resume, reviewed without mercy.',
    color: scoreColor(score),
    fields,
    footer: { text: 'Full roast, free, no signup — ' + siteUrl }
  };
}

// Cut at a word boundary. Slicing mid-word looks like a rendering fault rather
// than an editorial choice, and this text is the product's voice — a roast that
// stops mid-insult lands worse than a shorter one that finishes its thought.
function truncate(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour the boundary if it is reasonably near the end, otherwise a
  // long unbroken token would collapse the line to almost nothing.
  return (lastSpace > n * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:—-]+$/, '') + '…';
}

// Resolved through the agent's own contract key, same as the share card. Reading
// result.score directly would work for exactly one of the ten scoring agents.
function pickScore(result) {
  if (!result || typeof result !== 'object') return null;
  for (const k of ['ats_score', 'score', 'overall_score']) {
    const n = parseFloat(result[k]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n);
  }
  return null;
}

function scoreColor(score) {
  if (score === null) return 0x8F00FF;
  if (score < 40) return 0xC62828;
  if (score < 70) return 0xF9A825;
  return 0x2E7D32;
}

module.exports = {
  verifyInteraction,
  roastModal,
  modalValue,
  userId,
  resultEmbed,
  pickScore,
  TYPE,
  RESPONSE,
  EPHEMERAL,
  ED25519_DER_PREFIX
};
