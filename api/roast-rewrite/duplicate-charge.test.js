// roast-rewrite — regression test for the double-charge hole (2026-08-07).
//
// What was wrong: `create` minted a fresh order and a fresh Stripe checkout on
// every call, unconditionally. The only dedup anywhere on the path was
// composer.markPaid's check on `session.id`, which defends against Stripe
// RETRYING one webhook — two checkouts are two sessions, two orders and two
// charges, and nothing looked at whether the buyer had already paid for this
// exact resume.
//
// It was reachable by the most ordinary route there is: the upsell button stays
// live on the roast page after purchase, the page survives the Stripe round
// trip (that is what the cancelled-checkout recovery is for), and delivery was
// taking 354s behind a page promising "about a minute" — so the buyer had every
// reason to go back and press it again.
//
// This drives the real handler against a fake blob container with real ETag
// semantics, with Stripe stubbed so a "charge" is observable as a call count.

const test = require('node:test');
const assert = require('node:assert');

// ── Stripe stub, installed before the handler is required ──
const stripePath = require.resolve('../_lib/ambientScore/stripeClient');
let checkoutCalls = [];
require.cache[stripePath] = {
  id: stripePath, filename: stripePath, loaded: true,
  exports: {
    async createRewriteCheckout(args) {
      checkoutCalls.push(args);
      return { checkoutUrl: 'https://checkout.stripe.test/' + args.orderId };
    }
  }
};

const storage = require('../_utils/companyStorage');
const composer = require('../_lib/roastRewrite/composer');
const handler = require('./index');

function makeFakeContainer(hooks) {
  hooks = hooks || {};
  const store = new Map();
  let seq = 0;
  return {
    store,
    async createIfNotExists() { return {}; },
    getBlockBlobClient(name) {
      return {
        async download() {
          // A non-404 is how a real read failure arrives: getStateWithMeta
          // reports failed:true, which must not be read as "no orders yet".
          if (hooks.failReadsOf === name) { const e = new Error('ServiceUnavailable'); e.statusCode = 503; throw e; }
          const rec = store.get(name);
          if (!rec) { const e = new Error('BlobNotFound'); e.statusCode = 404; throw e; }
          return { etag: rec.etag, readableStreamBody: [Buffer.from(rec.content)] };
        },
        async upload(content, _len, opts) {
          const rec = store.get(name);
          const cond = (opts && opts.conditions) || {};
          if (cond.ifMatch && (!rec || rec.etag !== cond.ifMatch)) {
            const e = new Error('ConditionNotMet'); e.statusCode = 412; throw e;
          }
          if (cond.ifNoneMatch === '*' && rec) {
            const e = new Error('BlobAlreadyExists'); e.statusCode = 409; throw e;
          }
          store.set(name, { content, etag: 'etag-' + (++seq) });
          return {};
        }
      };
    }
  };
}

function seed(c, key, value) {
  c.store.set(key + '.json', { content: JSON.stringify(value), etag: 'etag-seed-' + key });
}
function read(c, key) {
  const rec = c.store.get(key + '.json');
  return rec ? JSON.parse(rec.content) : null;
}

const RESUME = 'Senior engineer with a decade of backend work. '.repeat(12); // > 200 chars
const POSTING = 'Staff Engineer, Platform. You will own the ingest pipeline.';

function newContainer() {
  const c = makeFakeContainer();
  seed(c, 'systemConfig', { roastRewrite: { enabled: true, priceCents: 900 } });
  seed(c, 'roast_rewrite_queue', []);
  return c;
}

async function create(container, body, ip) {
  storage._setContainerClientForTests(container);
  const ctx = { res: null, log: Object.assign(function () {}, { warn() {}, error() {}, info() {} }) };
  await handler(ctx, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip || '203.0.113.7' },
    body: Object.assign({ action: 'create', resumeText: RESUME }, body)
  });
  return ctx.res;
}

test('the first purchase mints a checkout as normal', async () => {
  checkoutCalls = [];
  const c = newContainer();
  const res = await create(c, { jobDescription: POSTING });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.checkoutUrl, 'first purchase must reach Stripe');
  assert.strictEqual(checkoutCalls.length, 1);
  const q = read(c, 'roast_rewrite_queue');
  assert.strictEqual(q.length, 1);
  assert.ok(q[0].fingerprint, 'the order must carry the fingerprint that makes dedup possible');
});

test('paying a second time for a resume already delivered is refused, and no charge is created', async () => {
  checkoutCalls = [];
  const c = newContainer();
  await create(c, { jobDescription: POSTING });

  // The buyer's order completes.
  const q = read(c, 'roast_rewrite_queue');
  q[0].status = 'delivered';
  q[0].deliveredAt = new Date().toISOString();
  seed(c, 'roast_rewrite_queue', q);
  const firstOrderId = q[0].orderId;
  checkoutCalls = [];

  // They go back and press the button again.
  const res = await create(c, { jobDescription: POSTING });

  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(checkoutCalls.length, 0, 'a second Stripe checkout is a second $9 charge');
  assert.strictEqual(res.body.alreadyPurchased, true);
  assert.strictEqual(res.body.orderId, firstOrderId, 'must point at the order they already own');
  assert.strictEqual(res.body.key, composer.buildRewriteToken(firstOrderId), 'the link has to actually open');
  assert.strictEqual(read(c, 'roast_rewrite_queue').length, 1, 'no second order may be recorded');
});

test('every status that means money changed hands blocks a second charge', async () => {
  for (const status of ['paid', 'processing', 'delivered', 'failed']) {
    checkoutCalls = [];
    const c = newContainer();
    await create(c, { jobDescription: POSTING });
    const q = read(c, 'roast_rewrite_queue');
    q[0].status = status;
    seed(c, 'roast_rewrite_queue', q);
    checkoutCalls = [];

    const res = await create(c, { jobDescription: POSTING });
    assert.strictEqual(checkoutCalls.length, 0, status + ' must not be chargeable again');
    assert.strictEqual(res.body.alreadyPurchased, true, 'expected alreadyPurchased for status ' + status);
  }
});

test('an abandoned unpaid order never blocks the buyer from actually paying', async () => {
  checkoutCalls = [];
  const c = newContainer();
  await create(c, { jobDescription: POSTING });   // left at 'created'
  checkoutCalls = [];

  const res = await create(c, { jobDescription: POSTING });
  assert.strictEqual(checkoutCalls.length, 1, 'a never-paid order must not lock them out of buying');
  assert.ok(res.body.checkoutUrl);
  assert.strictEqual(read(c, 'roast_rewrite_queue').length, 2);
});

test('the same resume aimed at a different posting is a different product, and is purchasable', async () => {
  checkoutCalls = [];
  const c = newContainer();
  await create(c, { jobDescription: POSTING });
  const q = read(c, 'roast_rewrite_queue');
  q[0].status = 'delivered';
  seed(c, 'roast_rewrite_queue', q);
  checkoutCalls = [];

  const res = await create(c, { jobDescription: 'Engineering Manager, Growth. Totally different role.' });
  assert.strictEqual(checkoutCalls.length, 1, 'targeting a different job is a genuinely different rewrite');
  assert.ok(res.body.checkoutUrl);
});

test('secondaryInput is fingerprinted the same as jobDescription, so the client spelling cannot bypass the guard', async () => {
  checkoutCalls = [];
  const c = newContainer();
  await create(c, { jobDescription: POSTING });
  const q = read(c, 'roast_rewrite_queue');
  q[0].status = 'delivered';
  seed(c, 'roast_rewrite_queue', q);
  checkoutCalls = [];

  // pixel-agent-run sends `jobDescription`, but the endpoint also accepts the
  // free path's `secondaryInput` spelling. Both must hash identically or the
  // guard is bypassable by switching field name.
  const res = await create(c, { secondaryInput: POSTING });
  assert.strictEqual(checkoutCalls.length, 0, 'the other accepted spelling must hash to the same order');
  assert.strictEqual(res.body.alreadyPurchased, true);
});

test('returning an already-purchased link does not consume the create rate limit', async () => {
  checkoutCalls = [];
  const c = newContainer();
  await create(c, { jobDescription: POSTING });
  const q = read(c, 'roast_rewrite_queue');
  q[0].status = 'delivered';
  seed(c, 'roast_rewrite_queue', q);

  const before = read(c, 'cc_rewrite_ratelimit');
  const beforeHits = (before && before['203.0.113.7'] || []).length;

  await create(c, { jobDescription: POSTING });

  const after = read(c, 'cc_rewrite_ratelimit');
  const afterHits = (after && after['203.0.113.7'] || []).length;
  assert.strictEqual(afterHits, beforeHits,
    'being handed back something you already bought must not spend your create budget');
});

test('a failed queue read refuses the checkout rather than guessing nobody has paid', async () => {
  checkoutCalls = [];
  const c = makeFakeContainer({ failReadsOf: 'roast_rewrite_queue.json' });
  seed(c, 'systemConfig', { roastRewrite: { enabled: true, priceCents: 900 } });

  const res = await create(c, { jobDescription: POSTING });

  assert.strictEqual(checkoutCalls.length, 0, 'an unreadable queue could be hiding a purchase they already made');
  assert.strictEqual(res.status, 503);
  assert.match(res.body.error, /nothing was charged/i, 'silence at the buy button reads as "did my card just get taken?"');
});

test('orders predating the fingerprint cannot swallow a new purchase', async () => {
  // A delivered order from before this shipped has no fingerprint. If the
  // lookup matched loosely it would hand a stranger someone else's rewrite.
  checkoutCalls = [];
  const c = newContainer();
  seed(c, 'roast_rewrite_queue', [
    { orderId: 'rr_legacy_1', status: 'delivered', createdAt: '2026-08-04T00:00:00.000Z', retryCount: 0, email: null }
  ]);

  const res = await create(c, { jobDescription: POSTING });
  assert.strictEqual(checkoutCalls.length, 1, 'a fingerprint-less legacy order must not match anything');
  assert.ok(res.body.checkoutUrl);
});
