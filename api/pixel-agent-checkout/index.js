const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const { extractUserInfo } = require('../_utils/cfAuth');
const { getProduct } = require('../_lib/stripe/productCatalog');
const { createCheckoutSession, findCustomerByEmail, createCustomer, SITE_URL } = require('../_lib/stripe/stripeClient');
const { loadEntitlements, saveEntitlements, defaultRecord } = require('../_lib/stripe/entitlements');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token, X-CF-Auth-Principal'
};

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    const { userId, email, isAuthenticated } = extractUserInfo(req, context);

    if (!isAuthenticated) {
      context.res = {
        status: 401,
        headers: CORS_HEADERS,
        body: { error: 'Authentication required' }
      };
      return;
    }

    const body = req.body || {};
    const { productId } = body;

    if (!productId) {
      context.res = {
        status: 400,
        headers: CORS_HEADERS,
        body: { error: 'productId is required' }
      };
      return;
    }

    // Only allow Pixel Agent products
    if (!productId.startsWith('pa-')) {
      context.res = {
        status: 400,
        headers: CORS_HEADERS,
        body: { error: 'Invalid product for Pixel Agents: ' + productId }
      };
      return;
    }

    const product = getProduct(productId);
    if (!product) {
      context.res = {
        status: 400,
        headers: CORS_HEADERS,
        body: { error: 'Unknown product: ' + productId }
      };
      return;
    }

    if (!product.stripePrice) {
      context.res = {
        status: 500,
        headers: CORS_HEADERS,
        body: { error: 'Product price not configured' }
      };
      return;
    }

    // Get or create Stripe customer
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    let record = await loadEntitlements(containerClient, userId);
    let customerId = record && record.stripeCustomerId;

    if (!customerId && email) {
      const existing = await findCustomerByEmail(email);
      if (existing) {
        customerId = existing.id;
      } else {
        const newCustomer = await createCustomer({ email, metadata: { userId } });
        customerId = newCustomer.id;
      }

      if (!record) record = defaultRecord(userId);
      record.stripeCustomerId = customerId;
      await saveEntitlements(containerClient, userId, record);
    }

    const successUrl = SITE_URL + '/pixel-agents/?checkout=success&session_id={CHECKOUT_SESSION_ID}';
    const cancelUrl = SITE_URL + '/pixel-agents/?checkout=cancelled';

    const session = await createCheckoutSession({
      mode: product.mode || 'payment',
      priceId: product.stripePrice,
      successUrl,
      cancelUrl,
      metadata: { userId, productId },
      customerId: customerId || undefined,
      customerEmail: !customerId ? email : undefined
    });

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: { checkoutUrl: session.checkoutUrl, sessionId: session.sessionId }
    };
  } catch (error) {
    context.log.error('[PA Checkout] Error: ' + error.message);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Checkout error: ' + error.message }
    };
  }
};
