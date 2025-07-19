const { BlobServiceClient } = require('@azure/storage-blob');

// CORS support added by Cascade 2025-07-12
module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, api-key',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
    return;
  }
  try {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set.");
    }

    const containerName = 'nova-memory';
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);

    let latestBlob = null;
    let latestTime = new Date(0);

    // Find the most recent blob by createdOn timestamp
    for await (const blob of containerClient.listBlobsFlat()) {
      const blobTime = new Date(blob.properties.createdOn);
      if (blobTime > latestTime) {
        latestTime = blobTime;
        latestBlob = blob;
      }
    }

    if (!latestBlob) {
      // Robust CORS support added by Windsurf 2025-07-12
      context.res = {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, api-key'
        },
        body: JSON.stringify({ error: "No mood data found in nova-memory." })
      };
      return;
    }

    // Download and parse the latest blob
    const blobClient = containerClient.getBlobClient(latestBlob.name);
    const downloadResponse = await blobClient.download();
    const data = await streamToText(downloadResponse.readableStreamBody);
    const moodData = JSON.parse(data);

    // Robust CORS support added by Windsurf 2025-07-12
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, api-key'
      },
      body: JSON.stringify(moodData)
    };
  } catch (error) {
    context.log.error("Error fetching mood:", error.message);
    // Robust CORS support added by Windsurf 2025-07-12
    context.res = {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, api-key'
      },
      body: JSON.stringify({ error: "Failed to fetch mood: " + error.message })
    };
  }
};

async function streamToText(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}