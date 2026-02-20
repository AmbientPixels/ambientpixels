// content/publishDocument.js — Executor for publish_document actions
// Called by the Action Center's Execute button via actionsExecute router.
// Reads the document from storage, determines visibility, writes to
// blogPosts (public) or publishedDocs (internal), and updates doc status.

const storage = require('../../../_utils/companyStorage');

const PUBLIC_KINDS = ['marketing_post', 'product_brief'];

async function publishDocument(action) {
  const payload = action.payload || action.action_payload || {};
  const documentId = payload.documentId || payload.document_id;
  const slug = payload.slug;
  const title = payload.title;

  if (!documentId) {
    throw { code: 'MISSING_DOC_ID', message: 'publish_document action missing documentId in payload' };
  }

  // Read the document
  const docs = (await storage.getState('documents')) || [];
  const docIdx = docs.findIndex(d => d.id === documentId);
  if (docIdx === -1) {
    throw { code: 'DOC_NOT_FOUND', message: 'Document not found: ' + documentId };
  }

  const doc = docs[docIdx];
  const contentMd = doc.content_md || '';

  if (!contentMd || contentMd.length < 10) {
    throw { code: 'EMPTY_CONTENT', message: 'Document content is empty or too short (' + contentMd.length + ' chars)' };
  }

  // Determine visibility
  const docKind = doc.kind || payload.kind || '';
  const visibility = payload.visibility || (PUBLIC_KINDS.indexOf(docKind) !== -1 ? 'public' : 'internal');
  const isPublic = visibility === 'public';
  const publicUrl = isPublic ? '/blog/' + slug : '/docs/published/' + slug;
  const now = new Date().toISOString();

  // Generate excerpt for blog posts
  let excerpt = '';
  if (isPublic) {
    excerpt = contentMd.replace(/#{1,6}\s+/g, '').replace(/[*_`~\[\]()>]/g, '').replace(/\n+/g, ' ').trim().substring(0, 200);
    if (contentMd.length > 200) excerpt += '...';
  }

  // Write to appropriate store
  const storageKey = isPublic ? 'blogPosts' : 'publishedDocs';
  const store = (await storage.getState(storageKey)) || [];

  const publishEntry = {
    id: 'pub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    documentId: documentId,
    actionId: action.id,
    title: title || doc.title,
    slug: slug,
    kind: doc.kind,
    content_md: contentMd,
    target_path: isPublic ? '/blog/' + slug : '/docs/published/' + slug,
    public_url: publicUrl,
    visibility: visibility,
    excerpt: excerpt,
    published_by: (action.approval && action.approval.approved_by) || 'pixelpusher',
    published_at: now,
    tags: doc.tags || [],
    created_by: doc.created_by,
    hero_image_asset_id: doc.hero_image_asset_id || null,
    inline_image_assets: doc.inline_image_assets || []
  };
  store.push(publishEntry);
  if (store.length > 200) store.splice(0, store.length - 200);
  await storage.setState(storageKey, store);

  // Update document status
  docs[docIdx].status = 'published';
  docs[docIdx].updated_at = now;
  docs[docIdx].published_at = now;
  docs[docIdx].published_by = publishEntry.published_by;
  docs[docIdx].publish_entry_id = publishEntry.id;
  docs[docIdx].visibility = visibility;
  docs[docIdx].public_url = publicUrl;
  await storage.setState('documents', docs);

  // Update approval queue
  try {
    const queue = (await storage.getState('approvalQueue')) || [];
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].action_id === action.id) {
        queue[i].status = 'approved';
        break;
      }
    }
    await storage.setState('approvalQueue', queue);
  } catch (e) { /* non-fatal */ }

  // v2.4.4: Mark artifact as published with canonical URL
  try {
    const artifacts = (await storage.getState('ap_artifacts')) || [];
    let artifactUpdated = false;
    for (let i = 0; i < artifacts.length; i++) {
      if (artifacts[i].actionId === action.id || (artifacts[i].documentId === documentId && artifacts[i].status === 'draft')) {
        artifacts[i].status = 'published';
        artifacts[i].url = isPublic ? 'https://ambientpixels.ai' + publicUrl : publicUrl;
        artifacts[i].publishedAt = now;
        artifactUpdated = true;
        break;
      }
    }
    if (artifactUpdated) {
      await storage.setState('ap_artifacts', artifacts);
    }
  } catch (e) { /* non-fatal — artifact registry update failed */ }

  // Audit log
  try {
    const auditLog = (await storage.getState('actionAuditLog')) || [];
    auditLog.push({
      id: 'alog-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      type: 'publish-executed-via-action-center',
      data: { actionId: action.id, documentId, title: doc.title, slug, visibility, publishEntryId: publishEntry.id },
      timestamp: now
    });
    if (auditLog.length > 500) auditLog.splice(0, auditLog.length - 500);
    await storage.setState('actionAuditLog', auditLog);
  } catch (e) { /* non-fatal */ }

  return {
    receipt: {
      publish_entry_id: publishEntry.id,
      target_path: publishEntry.target_path,
      public_url: publicUrl,
      visibility: visibility,
      slug: slug,
      published_at: now
    }
  };
}

module.exports = { publishDocument };
