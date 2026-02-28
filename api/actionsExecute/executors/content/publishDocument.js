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
    inline_image_assets: doc.inline_image_assets || [],
    promote: doc.promote || false
  };
  // Dedup: skip if slug already published
  const _existingIdx = store.findIndex(function(e) { return e.slug === slug; });
  if (_existingIdx === -1) {
    store.push(publishEntry);
    if (store.length > 200) store.splice(0, store.length - 200);
    await storage.setState(storageKey, store);
  }

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

  // AUTO-CLOSE: Mark parent blog task + child hero image tasks as done after successful publish
  try {
    const tasks = (await storage.getState('tasks')) || [];
    const parentTaskId = (doc.source && doc.source.task_id) || doc.taskId || null;
    let tasksChanged = false;

    if (parentTaskId) {
      const parentIdx = tasks.findIndex(function(t) { return t.id === parentTaskId; });
      if (parentIdx !== -1 && tasks[parentIdx].status !== 'done') {
        tasks[parentIdx].status = 'done';
        tasks[parentIdx].updatedAt = now;
        if (!tasks[parentIdx].comments) tasks[parentIdx].comments = [];
        tasks[parentIdx].comments.push({
          id: 'cmt-pub-done-' + Date.now(),
          author: 'system',
          text: 'Blog post "' + (doc.title || slug) + '" published successfully. Task auto-closed.',
          type: 'system',
          createdAt: now
        });
        tasksChanged = true;
      }

      // Close child hero image tasks
      for (var ti = 0; ti < tasks.length; ti++) {
        if (tasks[ti].parent_task_id === parentTaskId &&
            (tasks[ti].tags || []).indexOf('hero-image') !== -1 &&
            tasks[ti].status !== 'done') {
          tasks[ti].status = 'done';
          tasks[ti].updatedAt = now;
          if (!tasks[ti].comments) tasks[ti].comments = [];
          tasks[ti].comments.push({
            id: 'cmt-hero-done-' + Date.now(),
            author: 'system',
            text: 'Parent blog post published. Hero image task auto-closed.',
            type: 'system',
            createdAt: now
          });
          tasksChanged = true;
        }
      }

      if (tasksChanged) {
        await storage.setState('tasks', tasks);
      }
    }
  } catch (e) { /* non-fatal — task auto-close failed */ }

  // AUTO-PROMOTE: When CEO publishes with promote=true, auto-create Echo social tasks
  if (isPublic && doc.promote) {
    try {
      const tasks = (await storage.getState('tasks')) || [];
      const blogUrl = 'https://ambientpixels.ai/blog/' + slug;
      const platforms = ['linkedin', 'x', 'bluesky'];
      const platformLimits = { linkedin: '3000 chars', x: '280 chars', bluesky: '300 chars' };
      let tasksCreated = 0;

      // Resolve objective_id and campaign_id from parent task if doc doesn't have them
      var _promoObjectiveId = doc.objective_id || null;
      var _promoCampaignId = doc.campaign_id || null;
      if ((!_promoObjectiveId || !_promoCampaignId) && doc.taskId) {
        var _parentTask = tasks.find(function(t) { return t.id === doc.taskId; });
        if (_parentTask) {
          if (!_promoObjectiveId) _promoObjectiveId = _parentTask.objective_id || null;
          if (!_promoCampaignId) _promoCampaignId = _parentTask.campaign_id || null;
        }
      }

      for (var pi = 0; pi < platforms.length; pi++) {
        var plat = platforms[pi];
        // Dedup: skip if a social promo task for this platform + doc already exists
        var _promoExists = tasks.some(function(t) {
          return t.status !== 'done' && t.assignee === 'echo' &&
            (t.title || '').toLowerCase().indexOf(plat) !== -1 &&
            (t.title || '').toLowerCase().indexOf(slug) !== -1;
        });
        if (_promoExists) continue;

        var promoTask = {
          id: 'task_' + Date.now() + '_promo_' + plat + '_' + Math.random().toString(36).substr(2, 4),
          title: 'Promote blog post on ' + (plat === 'x' ? 'X (Twitter)' : plat.charAt(0).toUpperCase() + plat.slice(1)) + ': ' + (doc.title || slug),
          description: 'The blog post "' + (doc.title || slug) + '" has been published and the CEO approved it for social promotion.\n\n'
            + 'Blog URL: ' + blogUrl + '\n'
            + 'Platform: ' + plat + '\n'
            + 'Max length: ' + platformLimits[plat] + '\n'
            + 'Document ID: ' + documentId + '\n'
            + 'Artifact ID: ' + publishEntry.id + '\n\n'
            + 'Use create-social-action with this taskId. Include the blog URL in your post. '
            + 'Use artifact_id: "' + publishEntry.id + '" if the URL needs to be resolved dynamically.',
          taskType: 'social_' + plat,
          status: 'todo',
          priority: 'medium',
          assignee: 'echo',
          source: 'heartbeat',
          created_by: 'system',
          parent_task_id: null,
          objective_id: _promoObjectiveId,
          campaign_id: _promoCampaignId,
          createdAt: now,
          updatedAt: now,
          dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          tags: ['social-promo', 'auto-created', 'promote-pipeline', 'blog-' + slug],
          comments: [{
            id: 'cmt-promo-' + Date.now() + '-' + plat,
            author: 'system',
            text: 'Auto-created: CEO published "' + (doc.title || slug) + '" with promotion enabled. Create a ' + plat + ' post to promote the blog. URL: ' + blogUrl,
            type: 'system',
            createdAt: now
          }]
        };
        tasks.push(promoTask);
        tasksCreated++;
      }

      if (tasksCreated > 0) {
        await storage.setState('tasks', tasks);
      }
    } catch (e) { /* non-fatal — social task auto-creation failed */ }
  }

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
