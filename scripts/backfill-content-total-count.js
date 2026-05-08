#!/usr/bin/env node
/**
 * One-shot: count all blobs under usage/ in the company-state container
 * and seed content-engine/total-count.json with the historical total.
 *
 * Run after deploying the bumpTotalGenerations wiring so existing
 * generations aren't undercounted in /api/blindspotstats.
 *
 * Usage:
 *   AZURE_STORAGE_CONNECTION_STRING="..." node scripts/backfill-content-total-count.js
 *   # OR rely on managed identity if running inside Azure
 *
 * Prints a summary; does NOT increment beyond the discovered count
 * (idempotent — running it twice still ends at the same number).
 *
 * If the listing finds zero blobs (e.g. wrong connection string or empty
 * container), the script aborts with exit code 1 BEFORE writing to the
 * counter blob — refusing to overwrite a real count with 0.
 */
const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT = 'cardforgeblobdata';
const CONTAINER = 'company-state';
const COUNTER_PATH = 'content-engine/total-count.json';
const USAGE_PREFIX = 'usage/';

async function getClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const { DefaultAzureCredential } = require('@azure/identity');
  return new BlobServiceClient(
    `https://${STORAGE_ACCOUNT}.blob.core.windows.net`,
    new DefaultAzureCredential()
  );
}

async function streamToText(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

(async () => {
  const svc = await getClient();
  const container = svc.getContainerClient(CONTAINER);

  let total = 0;
  let blobCount = 0;
  let parsed = 0;
  let skipped = 0;
  let falledBack = 0;

  console.log('Listing usage/ blobs...');
  for await (const blob of container.listBlobsFlat({ prefix: USAGE_PREFIX })) {
    blobCount++;
    try {
      const dl = await container.getBlockBlobClient(blob.name).download();
      const body = await streamToText(dl.readableStreamBody);
      const rec = JSON.parse(body);
      // imagesGenerated is the field on the usage record. If missing/invalid
      // we fall back to 1 (a usage record presumably represents at least
      // one generation), but track how often the fallback fires so the
      // operator can spot non-conforming records in the summary.
      if (typeof rec.imagesGenerated === 'number' && rec.imagesGenerated > 0) {
        total += rec.imagesGenerated;
      } else {
        total += 1;
        falledBack++;
      }
      parsed++;
    } catch (e) {
      console.warn(`  skip ${blob.name}: ${e.message}`);
      skipped++;
    }
    if (blobCount % 100 === 0) console.log(`  scanned ${blobCount} blobs (total so far: ${total})`);
  }

  console.log(`\nScanned: ${blobCount} blob(s) | Parsed: ${parsed} | Skipped: ${skipped} | Fell-back: ${falledBack}`);

  // Guard: a zero-blob scan against the counter blob would silently overwrite
  // any previously correct value with 0. Almost always indicates misconfiguration
  // (wrong AZURE_STORAGE_CONNECTION_STRING, wrong container, wrong prefix).
  if (blobCount === 0) {
    console.warn('WARNING: No usage/ blobs found. Check AZURE_STORAGE_CONNECTION_STRING and container name.');
    console.warn('Refusing to overwrite the counter blob with 0. Aborting.');
    process.exit(1);
  }

  console.log(`Computed historical total: ${total}`);

  const counterBlob = container.getBlockBlobClient(COUNTER_PATH);
  const payload = JSON.stringify({ count: total, updatedAt: new Date().toISOString() }, null, 2);
  await counterBlob.upload(Buffer.from(payload), Buffer.byteLength(payload), {
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
  console.log(`Wrote ${COUNTER_PATH} = { count: ${total} }`);
})().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
