const companyStorage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  if (req.method !== 'POST') {
    context.res = { status: 405, headers: corsHeaders, body: { error: 'Method not allowed' } };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  // Auth: accept write secret OR authenticated SWA user (same as company-state)
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const clientPrincipal = (req.headers && req.headers['x-ms-client-principal']) || '';
  const isAuthenticated = !!clientPrincipal;
  if (!companyStorage.validateSecret(secret) && !isAuthenticated) {
    context.res = { status: 403, headers: corsHeaders, body: { error: 'Invalid write secret and no authenticated user' } };
    return;
  }

  try {
    const documents = await companyStorage.getState('documents') || [];
    const imageAssets = await companyStorage.getState('imageAssets') || [];

    // Gallery-visible docs: status 'published'
    const galleryDocs = documents.filter(d => d.status === 'published');

    // Collect referenced asset IDs
    const referencedAssetIds = new Set();
    galleryDocs.forEach(doc => {
      if (doc.hero_image_asset_id) referencedAssetIds.add(doc.hero_image_asset_id);
      if (doc.inline_image_assets) {
        doc.inline_image_assets.forEach(item => {
          if (item.assetId) referencedAssetIds.add(item.assetId);
        });
      }
      // Optionally scan content_md for blob urls, but skip for now
    });

    // Non-gallery assets
    const nonGalleryAssets = imageAssets.filter(asset => !referencedAssetIds.has(asset.id) && !asset.galleryVisible);

    // Preserve gallery assets
    const galleryAssets = imageAssets.filter(asset => referencedAssetIds.has(asset.id) || asset.galleryVisible);

    // Remove non-gallery assets
    await companyStorage.setState('imageAssets', galleryAssets);

    // Log audit
    const audit = await companyStorage.getState('governanceLog') || [];
    audit.push({
      id: 'audit-' + Date.now(),
      type: 'reset_nongallery_assets',
      actor: isAuthenticated ? 'authenticated_user' : 'company_secret',
      timestamp: new Date().toISOString(),
      details: { removed: nonGalleryAssets.length, preserved: galleryAssets.length }
    });
    if (audit.length > 100) audit.splice(0, audit.length - 100);
    await companyStorage.setState('governanceLog', audit);

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { ok: true, removed: nonGalleryAssets.length, preserved: galleryAssets.length }
    };
  } catch (err) {
    context.log.error('[company-reset-nongallery-assets] Error:', err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Internal server error', details: err.message }
    };
  }
};
