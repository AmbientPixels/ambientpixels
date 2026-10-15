// studio/blob.js — the private `studio` container, shared by /api/studio and the Video Desk (and, from phase 3,
// the heartbeat filing tickets). One client per process.
const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER = 'studio';

let container = null;
async function getContainer() {
  if (container) return container;
  if (!process.env.AZURE_STORAGE_CONNECTION_STRING) throw new Error('storage not configured');
  const c = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING).getContainerClient(CONTAINER);
  await c.createIfNotExists(); // no access option = private
  container = c;
  return c;
}

async function readJson(name) {
  const blob = (await getContainer()).getBlockBlobClient(name);
  try { return JSON.parse((await blob.downloadToBuffer()).toString('utf8')); }
  catch (e) { if (e.statusCode === 404) return null; throw e; }
}
async function writeJson(name, value, etag) {
  const body = JSON.stringify(value);
  await (await getContainer()).getBlockBlobClient(name).upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    ...(etag ? { conditions: { ifMatch: etag } } : {})
  });
}
// Read-change-write with the blob's version (ETag): if someone else wrote it in between (the operator cancelling
// while the worker reports), retry on the fresh copy instead of overwriting it. (Code review 2026-10-12, finding 7.)
// change(j) edits j in place and returns false to skip the write, or a string to refuse. Resolves to the final
// object, null if missing, or the refusal string.
async function mutateJson(name, change) {
  const blob = (await getContainer()).getBlockBlobClient(name);
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try { res = await blob.download(); } catch (e) { if (e.statusCode === 404) return null; throw e; }
    const chunks = [];
    for await (const c of res.readableStreamBody) chunks.push(c);
    const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const r = change(j);
    if (r === false) return j;
    if (typeof r === 'string') return r;
    try { await writeJson(name, j, res.etag); return j; }
    catch (e) { if (e.statusCode !== 412) throw e; }
  }
  throw new Error('busy: please retry');
}

module.exports = { getContainer, readJson, writeJson, mutateJson };
