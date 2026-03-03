// cc-confirm — POST /api/cc-confirm
// Confirms a ConversionCore strategy session time slot.
// Validates HMAC token, writes to dates blob, updates intake record.

const crypto = require('crypto');
const storage = require('../_utils/companyStorage');

const FORM_INTAKE_SALT = process.env.FORM_INTAKE_SALT || 'ambientcore-intake-v1-default';

const ALLOWED_ORIGINS = [
  'https://ambientpixels.ai',
  'https://www.ambientpixels.ai'
];

function _isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

function _corsHeaders(origin) {
  var matched = _isAllowedOrigin(origin) ? (origin || ALLOWED_ORIGINS[0]) : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': matched,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
  };
}

function _generateSlotToken(submissionId, slotIndex) {
  var message = 'confirm|' + submissionId + '|' + slotIndex;
  return crypto.createHmac('sha256', FORM_INTAKE_SALT)
    .update(message)
    .digest('hex')
    .substring(0, 40);
}

// Derive the canonical blob key from a submission ID like fi_2026-03-02_abc123
function _canonicalKey(id) {
  // id format: fi_YYYY-MM-DD_xxx → month is chars 3..10 → "2026-03"
  var month = id.substring(3, 10);
  return 'formIntake-' + month + '-' + id;
}

module.exports = async function (context, req) {
  var origin = req.headers && req.headers.origin;
  var headers = _corsHeaders(origin);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: headers, body: '' };
    return;
  }

  try {
    var body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = null; }
    }

    if (!body || !body.id || body.slot == null || !body.token) {
      context.res = {
        status: 400,
        headers: headers,
        body: JSON.stringify({ ok: false, error: 'missing_params', message: 'id, slot, and token are required.' })
      };
      return;
    }

    var submissionId = String(body.id).substring(0, 50);
    var slotIndex = parseInt(body.slot, 10);
    var token = String(body.token).substring(0, 60);

    if (isNaN(slotIndex) || slotIndex < 0 || slotIndex > 9) {
      context.res = {
        status: 400,
        headers: headers,
        body: JSON.stringify({ ok: false, error: 'invalid_slot', message: 'Slot index is invalid.' })
      };
      return;
    }

    // Validate HMAC token
    var expectedToken = _generateSlotToken(submissionId, slotIndex);
    if (token !== expectedToken) {
      context.log.warn('[cc-confirm] Invalid token for', submissionId, 'slot:', slotIndex);
      context.res = {
        status: 403,
        headers: headers,
        body: JSON.stringify({ ok: false, error: 'invalid_token', message: 'This confirmation link is invalid or expired.' })
      };
      return;
    }

    // Load intake record
    var record = await storage.getState(_canonicalKey(submissionId));
    if (!record) {
      context.log.warn('[cc-confirm] Record not found:', submissionId);
      context.res = {
        status: 404,
        headers: headers,
        body: JSON.stringify({ ok: false, error: 'not_found', message: 'Submission not found.' })
      };
      return;
    }

    // Already confirmed?
    if (record.scheduling && record.scheduling.confirmedSlot) {
      var existing = record.scheduling.confirmedSlot;
      context.res = {
        status: 409,
        headers: headers,
        body: JSON.stringify({
          ok: false,
          error: 'already_confirmed',
          message: 'A time has already been confirmed for this session.',
          confirmedSlot: existing.label
        })
      };
      return;
    }

    // Validate slot index
    var slots = (record.scheduling && record.scheduling.proposedSlots) || [];
    if (slotIndex >= slots.length) {
      context.res = {
        status: 400,
        headers: headers,
        body: JSON.stringify({ ok: false, error: 'slot_not_found', message: 'The requested time slot does not exist.' })
      };
      return;
    }

    var confirmedSlot = slots[slotIndex];
    var now = new Date().toISOString();

    // Write to dates blob (AmbientOS calendar)
    var dates = (await storage.getState('dates')) || [];
    var contactName = (record.contact && record.contact.name) || 'Unknown';
    var contactCompany = (record.contact && record.contact.company) || '';

    var dateEntry = {
      id: 'date_cc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      title: 'Strategy Session \u2014 ' + contactName + (contactCompany ? ' (' + contactCompany + ')' : ''),
      date: confirmedSlot.date,
      time: String(confirmedSlot.hour).padStart(2, '0') + ':00',
      type: 'event',
      description: 'ConversionCore strategy call. Contact: ' +
        (record.contact ? record.contact.email : 'N/A') + '. Submission: ' + submissionId +
        (record.conversioncore && record.conversioncore.url ? '. Site: ' + record.conversioncore.url : '') +
        (record.conversioncore && record.conversioncore.score != null ? '. Score: ' + record.conversioncore.score + '/100' : '') + '.',
      created_by: 'cc-confirm',
      created_at: now,
      source: {
        type: 'conversioncore_strategy',
        submissionId: submissionId,
        slotIndex: slotIndex
      }
    };

    dates.push(dateEntry);
    await storage.setState('dates', dates);

    // Update intake record
    record.scheduling.confirmedSlot = {
      index: slotIndex,
      label: confirmedSlot.label,
      date: confirmedSlot.date,
      hour: confirmedSlot.hour,
      confirmedAt: now,
      dateEntryId: dateEntry.id
    };
    record.scheduling.status = 'confirmed';
    await storage.setState(_canonicalKey(submissionId), record);

    context.log('[cc-confirm] Confirmed:', submissionId, 'slot:', slotIndex, confirmedSlot.label);

    context.res = {
      status: 200,
      headers: headers,
      body: JSON.stringify({
        ok: true,
        confirmedSlot: confirmedSlot.label,
        date: confirmedSlot.date,
        hour: confirmedSlot.hour,
        dateEntryId: dateEntry.id
      })
    };

  } catch (err) {
    context.log.error('[cc-confirm] Error:', err.message, err.stack);
    context.res = {
      status: 500,
      headers: headers,
      body: JSON.stringify({ ok: false, error: 'internal_error', message: 'Something went wrong. Please try again.' })
    };
  }
};
