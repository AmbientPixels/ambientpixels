const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const { verifyWebhookSignature, retrieveSubscription } = require('../_lib/stripe/stripeClient');
const { getProduct } = require('../_lib/stripe/productCatalog');
const {
  loadEntitlements,
  grantProduct,
  activateSubscription,
  deactivateSubscription,
  markSubscriptionAtRisk
} = require('../_lib/stripe/entitlements');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const WEBHOOK_SECRET = process.env.SF_STRIPE_WEBHOOK_SECRET;

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, body: '' };
    return;
  }

  try {
    const signature = req.headers['stripe-signature'];
    const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

    if (!verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET)) {
      context.log.warn('[SF Webhook] Signature verification failed');
      context.res = { status: 400, body: 'Invalid signature' };
      return;
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = event.type;
    const obj = event.data && event.data.object;

    if (!obj) {
      context.res = { status: 200, body: 'No object in event' };
      return;
    }

    context.log('[SF Webhook] Received: ' + eventType);

    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    switch (eventType) {
      case 'checkout.session.completed': {
        const userId = obj.metadata && obj.metadata.userId;
        const productId = obj.metadata && obj.metadata.productId;
        const sessionId = obj.id;

        if (!userId || !productId) {
          context.log.warn('[SF Webhook] checkout.session.completed missing userId or productId in metadata');
          break;
        }

        await grantProduct(containerClient, userId, productId, sessionId);

        const product = getProduct(productId);
        if (product && product.mode === 'subscription' && obj.subscription) {
          await activateSubscription(containerClient, userId, obj.subscription, obj.customer);
        }

        context.log('[SF Webhook] Granted ' + productId + ' to user ' + userId);
        break;
      }

      case 'customer.subscription.updated': {
        const subId = obj.id;
        const status = obj.status;
        const customerId = obj.customer;

        const userId = await findUserBySubscription(containerClient, subId, customerId, context);
        if (!userId) {
          context.log.warn('[SF Webhook] Could not find user for subscription ' + subId);
          break;
        }

        if (status === 'active') {
          await activateSubscription(containerClient, userId, subId, customerId);
          context.log('[SF Webhook] Reactivated subscription for user ' + userId);
        } else if (status === 'canceled' || status === 'unpaid') {
          await deactivateSubscription(containerClient, userId);
          context.log('[SF Webhook] Deactivated subscription for user ' + userId);
        } else if (status === 'past_due') {
          await markSubscriptionAtRisk(containerClient, userId);
          context.log('[SF Webhook] Marked subscription at risk for user ' + userId);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subId = obj.id;
        const customerId = obj.customer;
        const userId = await findUserBySubscription(containerClient, subId, customerId, context);
        if (userId) {
          await deactivateSubscription(containerClient, userId);
          context.log('[SF Webhook] Subscription deleted for user ' + userId);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const subId = obj.subscription;
        const customerId = obj.customer;
        if (subId) {
          const userId = await findUserBySubscription(containerClient, subId, customerId, context);
          if (userId) {
            await markSubscriptionAtRisk(containerClient, userId);
            context.log('[SF Webhook] Payment failed, marked at risk for user ' + userId);
          }
        }
        break;
      }

      default:
        context.log('[SF Webhook] Unhandled event type: ' + eventType);
    }

    context.res = { status: 200, body: 'ok' };
  } catch (error) {
    context.log.error('[SF Webhook] Error: ' + error.message);
    context.res = { status: 500, body: 'Webhook processing error' };
  }
};

async function findUserBySubscription(containerClient, subscriptionId, customerId, context) {
  try {
    const sub = await retrieveSubscription(subscriptionId);
    if (sub && sub.metadata && sub.metadata.userId) {
      return sub.metadata.userId;
    }
  } catch (e) {
    context.log.warn('[SF Webhook] Could not retrieve subscription metadata: ' + e.message);
  }

  try {
    const iter = containerClient.listBlobsFlat({ prefix: 'billing/entitlements/' });
    for await (const blob of iter) {
      const blobClient = containerClient.getBlockBlobClient(blob.name);
      const downloadResponse = await blobClient.download(0);
      const chunks = [];
      for await (const chunk of downloadResponse.readableStreamBody) {
        chunks.push(chunk);
      }
      const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (record.subscriptionId === subscriptionId || record.stripeCustomerId === customerId) {
        return record.userId;
      }
    }
  } catch (e) {
    context.log.warn('[SF Webhook] Blob scan fallback failed: ' + e.message);
  }

  return null;
}
