const companyStorage = require('../_utils/companyStorage');

const COMPANY_SECRET = process.env.COMPANY_WRITE_SECRET;

module.exports = async function (context, req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (req.method === 'OPTIONS') {
    context.res = { status: 200, headers: corsHeaders, body: {} };
    return;
  }

  if (req.method !== 'POST') {
    context.res = { status: 405, headers: corsHeaders, body: { error: 'Method not allowed' } };
    return;
  }

  // Auth check
  const authHeader = req.headers.authorization;
  const isCompanySecret = authHeader === `Bearer ${COMPANY_SECRET}`;
  const isAuthenticated = req.headers['x-ms-client-principal'];
  if (!isCompanySecret && !isAuthenticated) {
    context.res = { status: 401, headers: corsHeaders, body: { error: 'Unauthorized' } };
    return;
  }

  try {
    const documents = await companyStorage.getState('documents') || [];
    const publishedDocs = await companyStorage.getState('publishedDocs') || [];

    // Gallery-visible docs: status 'published'
    const galleryDocs = documents.filter(d => d.status === 'published');
    const nonGalleryDocs = documents.filter(d => d.status !== 'published');

    // Remove non-gallery docs
    const newDocuments = galleryDocs;

    // Remove non-gallery IDs from publishedDocs (though published should be gallery)
    const galleryDocIds = new Set(galleryDocs.map(d => d.id));
    const newPublishedDocs = publishedDocs.filter(id => galleryDocIds.has(id));

    await companyStorage.setState('documents', newDocuments);
    await companyStorage.setState('publishedDocs', newPublishedDocs);

    // Log audit
    const audit = await companyStorage.getState('governanceLog') || [];
    audit.push({
      id: 'audit-' + Date.now(),
      type: 'reset_documents',
      actor: isAuthenticated ? 'authenticated_user' : 'company_secret',
      timestamp: new Date().toISOString(),
      details: { removed: nonGalleryDocs.length, preserved: galleryDocs.length }
    });
    if (audit.length > 100) audit.splice(0, audit.length - 100);
    await companyStorage.setState('governanceLog', audit);

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { ok: true, removed: nonGalleryDocs.length, preserved: galleryDocs.length }
    };
  } catch (err) {
    context.log.error('[company-reset-documents] Error:', err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Internal server error', details: err.message }
    };
  }
};
