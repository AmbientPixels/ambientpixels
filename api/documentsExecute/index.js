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

    // ── document.publish ──
    if (actionType === 'document.publish') {
      return await handleDocPublish(context, req, body);
    }

    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { error: 'Unknown action type: ' + actionType + '. Use "document.create", "document.update", "document.promote", or "document.publish".' }
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

// ── document.publish handler ──
// CEO-only: approves a publish_document action and writes markdown to blob storage
async function handleDocPublish(context, req, body) {
  // CEO-only gate
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = {
      status: 403,
      headers: corsHeaders,
      body: { error: 'Publish requires CEO authorization (x-company-secret header)' }
    };
    return;
  }

  const actionId = body.action_id || body.actionId;
  const decision = body.decision || 'approve'; // approve | reject
  const decisionNote = body.decision_note || body.note || '';

  if (!actionId) {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { error: 'Missing action_id' }
    };
    return;
  }

  // Load the action
  const actions = (await storage.getState('actions')) || [];
  const actionIdx = actions.findIndex(a => a.id === actionId);
  let action = actionIdx !== -1 ? actions[actionIdx] : null;
  let reconstructed = false;

  // Fallback: if action was trimmed from the actions array, reconstruct from approvalQueue + documents
  if (!action) {
    const approvalQueue = (await storage.getState('approvalQueue')) || [];
    const queueEntry = approvalQueue.find(q => q.action_id === actionId);
    if (!queueEntry || queueEntry.actionType !== 'publish_document') {
      context.res = { status: 404, headers: corsHeaders, body: { error: 'Action not found: ' + actionId } };
      return;
    }
    const docs = (await storage.getState('documents')) || [];
    const doc = docs.find(d => d.id === queueEntry.documentId);
    if (!doc) {
      context.res = { status: 404, headers: corsHeaders, body: { error: 'Document not found for action: ' + actionId } };
      return;
    }
    const slug = doc.slug || doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    action = {
      id: actionId,
      type: 'publish_document',
      payload: { documentId: doc.id, title: doc.title, slug: slug, kind: doc.kind, content_md: doc.content_md },
      approval: { status: 'pending' },
      execution: { status: 'pending', started_at: null, finished_at: null, attempts: 0, last_error: null, receipt: null },
      created_by: queueEntry.originAgent || 'unknown'
    };
    reconstructed = true;
    context.log('[DocsExecute] Reconstructed action from approvalQueue:', actionId);
  }

  // Must be a publish_document action
  if (action.type !== 'publish_document') {
    context.res = { status: 400, headers: corsHeaders, body: { error: 'Action is not a publish_document type: ' + action.type } };
    return;
  }

  // Must be pending approval
  if (!action.approval || action.approval.status !== 'pending') {
    context.res = { status: 409, headers: corsHeaders, body: { error: 'Action is not pending approval. Current status: ' + (action.approval && action.approval.status) } };
    return;
  }

  const now = new Date().toISOString();
  const documentId = action.payload && action.payload.documentId;
  const slug = action.payload && action.payload.slug;
  const title = action.payload && action.payload.title;

  // Visibility: public → /blog/<slug>, internal → /docs/published/<slug>
  // Can be set in request body, action payload, or defaults by doc kind
  const PUBLIC_KINDS = ['marketing_post', 'product_brief'];
  const requestVisibility = body.visibility || (action.payload && action.payload.visibility);
  const docKind = (action.payload && action.payload.kind) || '';
  const visibility = requestVisibility || (PUBLIC_KINDS.indexOf(docKind) !== -1 ? 'public' : 'internal');
  const isPublic = visibility === 'public';

  // ── REJECT path ──
  if (decision === 'reject') {
    action.approval.status = 'rejected';
    action.approval.decision_note = decisionNote;
    action.execution.status = 'failed';
    action.execution.finished_at = now;
    action.execution_status = 'rejected';
    if (actionIdx !== -1) { actions[actionIdx] = action; await storage.setState('actions', actions); }

    // Update doc status back to review
    if (documentId) {
      const docs = (await storage.getState('documents')) || [];
      const docIdx = docs.findIndex(d => d.id === documentId);
      if (docIdx !== -1) {
        docs[docIdx].status = 'rejected';
        docs[docIdx].updated_at = now;
        await storage.setState('documents', docs);
      }
    }

    // Update approval queue
    await _updateApprovalQueue(actionId, 'rejected');

    // ── Auto-route design feedback to Pixel ──
    // If CEO's rejection note mentions anything visual/design-related, auto-create a Pixel task
    const _designKeywords = /\b(image|hero|visual|design|graphic|photo|picture|thumbnail|banner|logo|layout|branding|square|landscape|portrait|aspect|dimension|resize|format|illustration|icon)\b/i;
    if (decisionNote && _designKeywords.test(decisionNote)) {
      try {
        const _tasks = (await storage.getState('tasks')) || [];
        // Dedup: check if an active Pixel design-revision task already exists for this doc
        const _existingPixelTask = _tasks.find(t =>
          t.assignee === 'pixel' && t.status !== 'done' &&
          ((t.title || '').indexOf(documentId) !== -1 || (t.description || '').indexOf(documentId) !== -1) &&
          (t.title || '').indexOf('Design revision') !== -1
        );
        if (!_existingPixelTask) {
          const _pixelTask = {
            id: 'task_' + Date.now() + '_designrev_' + Math.random().toString(36).substr(2, 4),
            title: 'Design revision: ' + (title || 'Untitled').substring(0, 60),
            description: 'CEO rejected a publish action and flagged a design issue.\n\n' +
              'CEO feedback: "' + decisionNote + '"\n\n' +
              'Document ID: ' + documentId + '\nDocument title: ' + (title || 'Untitled') + '\nSlug: ' + (slug || '') + '\n\n' +
              'Review the CEO feedback and make the requested visual changes. ' +
              'If a hero image needs regeneration, use generate-image with the correct purpose (blog_header for blog posts). ' +
              'If other design work is needed, produce the deliverable and attach it to the document.',
            status: 'todo',
            priority: 'high',
            assignee: 'pixel',
            parent_task_id: (function() { var _pt = _tasks.find(function(t2) { return t2.status !== 'done' && t2.description && t2.description.indexOf(documentId) !== -1 && (t2.assignee === 'scribe' || t2.tags && t2.tags.indexOf('hero-image') !== -1); }); return _pt ? _pt.id : null; })(),
            createdAt: now,
            updatedAt: now,
            createdBy: 'system',
            source: 'auto:publish-rejection-design-feedback',
            tags: ['design-revision', 'ceo-feedback'],
            comments: [{
              id: 'cmt-' + Date.now(),
              author: 'system',
              text: 'Auto-created from CEO publish rejection. Design feedback detected in rejection note.',
              type: 'system',
              createdAt: now
            }]
          };
          _tasks.push(_pixelTask);
          await storage.setState('tasks', _tasks);
          context.log('[DocsExecute] Auto-created Pixel design-revision task:', _pixelTask.id, 'for doc:', documentId);
        } else {
          context.log('[DocsExecute] Pixel design-revision task already exists for doc:', documentId, '— skipping');
        }
      } catch (_pixelErr) {
        context.log.warn('[DocsExecute] Failed to auto-create Pixel task (non-fatal):', _pixelErr.message);
      }
    }

    // Audit + governance
    await _logAudit('publish-rejected', { actionId, documentId, title, slug, decisionNote, rejectedBy: 'pixelpusher' });
    await _logGovernance(storage, 'publish-rejected', { actionId, documentId, title, rejectedBy: 'pixelpusher' });

    context.log('[DocsExecute] Publish rejected:', actionId, title);
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { success: true, decision: 'rejected', actionId, documentId }
    };
    return;
  }

  // ── APPROVE + EXECUTE path ──
  // Step 1: Update approval status
  action.approval.status = 'approved';
  action.approval.approved_by = 'pixelpusher';
  action.approval.approved_at = now;
  action.approval.decision_note = decisionNote;
  action.execution.status = 'running';
  action.execution.started_at = now;
  action.execution.attempts = (action.execution.attempts || 0) + 1;
  action.execution_status = 'running';

  try {
    // Step 2: Read the document content
    const docs = (await storage.getState('documents')) || [];
    const docIdx = docs.findIndex(d => d.id === documentId);
    if (docIdx === -1) {
      throw new Error('Document not found: ' + documentId);
    }
    const doc = docs[docIdx];
    const contentMd = doc.content_md || '';

    if (!contentMd || contentMd.length < 10) {
      throw new Error('Document content is empty or too short');
    }

    // Generate excerpt for blog posts (first ~200 chars of plain text)
    var excerpt = '';
    if (isPublic) {
      excerpt = contentMd.replace(/#{1,6}\s+/g, '').replace(/[*_`~\[\]()>]/g, '').replace(/\n+/g, ' ').trim().substring(0, 200);
      if (contentMd.length > 200) excerpt += '...';
    }

    // Step 3: Write to appropriate storage (blogPosts for public, publishedDocs for internal)
    const storageKey = isPublic ? 'blogPosts' : 'publishedDocs';
    const publicUrl = isPublic ? '/blog/' + slug : '/docs/published/' + slug;
    const store = (await storage.getState(storageKey)) || [];

    const publishEntry = {
      id: 'pub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      documentId: documentId,
      actionId: actionId,
      title: title,
      slug: slug,
      kind: doc.kind,
      content_md: contentMd,
      target_path: isPublic ? '/blog/' + slug : 'content/docs/' + slug + '.md',
      public_url: publicUrl,
      visibility: visibility,
      excerpt: excerpt,
      published_by: 'pixelpusher',
      published_at: now,
      tags: doc.tags || [],
      created_by: doc.created_by,
      hero_image_asset_id: doc.hero_image_asset_id || null,
      inline_image_assets: doc.inline_image_assets || [],
      promote: doc.promote || false
    };
    store.push(publishEntry);
    if (store.length > 200) store.splice(0, store.length - 200);
    await storage.setState(storageKey, store);

    // Step 4: Update document status to published
    docs[docIdx].status = 'published';
    docs[docIdx].updated_at = now;
    docs[docIdx].published_at = now;
    docs[docIdx].published_by = 'pixelpusher';
    docs[docIdx].publish_entry_id = publishEntry.id;
    docs[docIdx].visibility = visibility;
    docs[docIdx].public_url = publicUrl;
    await storage.setState('documents', docs);

    // Step 5: Update action execution to success
    action.execution.status = 'success';
    action.execution.finished_at = now;
    action.execution.receipt = {
      publish_entry_id: publishEntry.id,
      target_path: publishEntry.target_path,
      public_url: publicUrl,
      visibility: visibility,
      slug: slug,
      published_at: now
    };
    action.execution_status = 'success';
    if (actionIdx !== -1) { actions[actionIdx] = action; await storage.setState('actions', actions); }

    // Step 6: Update approval queue
    await _updateApprovalQueue(actionId, 'approved');

    // Step 7: Audit + governance logs
    await _logAudit('publish-approved', { actionId, documentId, title, slug, visibility, approvedBy: 'pixelpusher' });
    await _logAudit('publish-executed', { actionId, documentId, title, slug, visibility, publishEntryId: publishEntry.id, targetPath: publishEntry.target_path });
    await _logGovernance(storage, 'publish-approved', { actionId, documentId, title, slug, visibility, approvedBy: 'pixelpusher' });
    await _logGovernance(storage, 'publish-executed', { actionId, documentId, title, slug, visibility, publishEntryId: publishEntry.id });

    context.log('[DocsExecute] Published (' + visibility + '):', actionId, title, '→', publicUrl);

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        success: true,
        decision: 'approved',
        visibility: visibility,
        actionId,
        documentId,
        publishEntry,
        message: 'Document published successfully to ' + (isPublic ? 'blog' : 'internal docs')
      }
    };

  } catch (execErr) {
    // Execution failed
    action.execution.status = 'failed';
    action.execution.finished_at = now;
    action.execution.last_error = { code: 'EXEC_ERROR', message: execErr.message };
    action.execution_status = 'failed';
    if (actionIdx !== -1) { actions[actionIdx] = action; await storage.setState('actions', actions); }

    await _logAudit('publish-failed', { actionId, documentId, title, slug, error: execErr.message });
    await _logGovernance(storage, 'publish-failed', { actionId, documentId, title, error: execErr.message });

    context.log.error('[DocsExecute] Publish execution failed:', execErr.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Publish execution failed', details: execErr.message, actionId }
    };
  }
}

// ── Helper: update approval queue entry ──
async function _updateApprovalQueue(actionId, status) {
  try {
    const queue = (await storage.getState('approvalQueue')) || [];
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].action_id === actionId) {
        queue[i].status = status;
        break;
      }
    }
    await storage.setState('approvalQueue', queue);
  } catch (e) { /* non-fatal */ }
}

// ── Helper: append to action audit log ──
async function _logAudit(type, data) {
  try {
    const log = (await storage.getState('actionAuditLog')) || [];
    log.push({
      id: 'alog-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      type: type,
      data: data,
      timestamp: new Date().toISOString()
    });
    if (log.length > 500) log.splice(0, log.length - 500);
    await storage.setState('actionAuditLog', log);
  } catch (e) { /* non-fatal */ }
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
