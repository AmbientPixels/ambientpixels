// documentsExecute — HTTP Trigger
// Handles document.create and document.promote actions
// document.create: any agent can create a draft (no approval needed)
// document.promote: CEO-only, requires approval, moves doc to final

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

const VALID_DOC_KINDS = ['spec', 'runbook', 'release_notes', 'product_brief', 'marketing_post', 'governance'];
const MAX_DOCS = 500;

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  // Kill switch
  if (process.env.DOCS_EXECUTION_ENABLED === 'false') {
    context.res = {
      status: 503,
      headers: corsHeaders,
      body: { error: 'Document execution is disabled', code: 'DOCS_DISABLED' }
    };
    return;
  }

  try {
    const body = req.body || {};
    const actionType = body.action || body.type;

    if (!actionType) {
      context.res = {
        status: 400,
        headers: corsHeaders,
        body: { error: 'Missing action type. Use "document.create" or "document.promote".' }
      };
      return;
    }

    // ── document.create ──
    if (actionType === 'document.create') {
      return await handleDocCreate(context, body);
    }

    // ── document.promote ──
    if (actionType === 'document.promote') {
      return await handleDocPromote(context, req, body);
    }

    // ── document.update ──
    if (actionType === 'document.update') {
      return await handleDocUpdate(context, body);
    }

    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { error: 'Unknown action type: ' + actionType + '. Use "document.create", "document.update", or "document.promote".' }
    };

  } catch (err) {
    context.log.error('[DocsExecute] Error:', err.message || err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Internal error', details: err.message }
    };
  }
};

// ── document.create handler ──
async function handleDocCreate(context, body) {
  const payload = body.payload || body;
  const title = payload.title;
  const contentMd = payload.content_md || payload.contentMd || '';

  if (!title) {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { error: 'Missing required field: title' }
    };
    return;
  }

  const kind = payload.kind || 'product_brief';
  if (VALID_DOC_KINDS.indexOf(kind) === -1) {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { error: 'Invalid kind. Valid: ' + VALID_DOC_KINDS.join(', ') }
    };
    return;
  }

  const doc = {
    id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    title: title,
    kind: kind,
    status: 'draft',
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    created_by: payload.created_by || body.created_by || 'unknown',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content_md: contentMd,
    source: {
      action_id: payload.action_id || body.action_id || null,
      task_id: payload.task_id || body.task_id || null
    }
  };

  const docs = (await storage.getState('documents')) || [];
  docs.push(doc);
  if (docs.length > MAX_DOCS) docs.splice(0, docs.length - MAX_DOCS);
  await storage.setState('documents', docs);

  // Log to governance
  await _logGovernance(storage, 'document-created', {
    document_id: doc.id,
    title: doc.title,
    kind: doc.kind,
    created_by: doc.created_by
  });

  context.log('[DocsExecute] Created draft:', doc.id, doc.title, 'by', doc.created_by);

  context.res = {
    status: 200,
    headers: corsHeaders,
    body: { success: true, document: doc }
  };
}

// ── document.update handler ──
async function handleDocUpdate(context, body) {
  const documentId = body.document_id || (body.payload && body.payload.document_id);
  if (!documentId) {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { error: 'Missing document_id' }
    };
    return;
  }

  const docs = (await storage.getState('documents')) || [];
  const idx = docs.findIndex(function (d) { return d.id === documentId; });
  if (idx === -1) {
    context.res = {
      status: 404,
      headers: corsHeaders,
      body: { error: 'Document not found: ' + documentId }
    };
    return;
  }

  const doc = docs[idx];

  // Only drafts and review docs can be updated
  if (doc.status === 'final') {
    context.res = {
      status: 403,
      headers: corsHeaders,
      body: { error: 'Cannot update a finalized document' }
    };
    return;
  }

  const payload = body.payload || body;
  if (payload.content_md !== undefined) doc.content_md = payload.content_md;
  if (payload.title !== undefined) doc.title = payload.title;
  if (payload.kind !== undefined && VALID_DOC_KINDS.indexOf(payload.kind) !== -1) doc.kind = payload.kind;
  if (Array.isArray(payload.tags)) doc.tags = payload.tags;
  if (payload.status === 'review' && doc.status === 'draft') doc.status = 'review';
  doc.updated_at = new Date().toISOString();

  docs[idx] = doc;
  await storage.setState('documents', docs);

  context.log('[DocsExecute] Updated doc:', doc.id, doc.title);

  context.res = {
    status: 200,
    headers: corsHeaders,
    body: { success: true, document: doc }
  };
}

// ── document.promote handler ──
async function handleDocPromote(context, req, body) {
  // CEO-only gate: require write secret
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = {
      status: 403,
      headers: corsHeaders,
      body: { error: 'Promote requires CEO authorization (x-company-secret header)' }
    };
    return;
  }

  const documentId = body.document_id || (body.payload && body.payload.document_id);
  if (!documentId) {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { error: 'Missing document_id' }
    };
    return;
  }

  const docs = (await storage.getState('documents')) || [];
  const idx = docs.findIndex(function (d) { return d.id === documentId; });
  if (idx === -1) {
    context.res = {
      status: 404,
      headers: corsHeaders,
      body: { error: 'Document not found: ' + documentId }
    };
    return;
  }

  const doc = docs[idx];
  if (doc.status === 'final') {
    context.res = {
      status: 409,
      headers: corsHeaders,
      body: { error: 'Document is already finalized' }
    };
    return;
  }

  doc.status = 'final';
  doc.updated_at = new Date().toISOString();
  doc.promoted_at = new Date().toISOString();
  doc.promoted_by = 'pixelpusher';
  docs[idx] = doc;
  await storage.setState('documents', docs);

  // Log governance entry
  await _logGovernance(storage, 'document-promoted', {
    document_id: doc.id,
    title: doc.title,
    kind: doc.kind,
    promoted_by: 'pixelpusher'
  });

  context.log('[DocsExecute] Promoted to final:', doc.id, doc.title);

  context.res = {
    status: 200,
    headers: corsHeaders,
    body: { success: true, document: doc }
  };
}

async function _logGovernance(storage, type, data) {
  try {
    const govLog = (await storage.getState('governanceLog')) || [];
    govLog.push({
      id: 'gov-' + Date.now(),
      type: type,
      data: data,
      timestamp: new Date().toISOString()
    });
    var trimmed = govLog.length > 500 ? govLog.slice(-500) : govLog;
    await storage.setState('governanceLog', trimmed);
  } catch (e) {
    // Non-fatal
  }
}
