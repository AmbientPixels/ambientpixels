// File: /api/dreamLogWriter/index.js

const { BlobServiceClient } = require("@azure/storage-blob");
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = "nova-memory"; // Your container
const blobName = "nova-dreams.json"; // Your dreams file

// CORS support added by Cascade 2025-07-12
module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, api-key',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
    return;
  }
  const dream = req.body?.dream;
  const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");

  if (!dream) {
    context.res = {
      status: 400,
      body: { error: "No dream provided." }
    };
    return;
  }

  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    let dreams = [];

    // Try to fetch existing dreams
    try {
      const downloadBlockBlobResponse = await blockBlobClient.download(0);
      const downloaded = await streamToString(downloadBlockBlobResponse.readableStreamBody);
      dreams = JSON.parse(downloaded || "[]");
    } catch (err) {
      context.log("💬 No existing dream file found. Creating new one.");
    }

    // Add the new dream at the beginning
    const dreamEntry = `💭 ${timestamp} — ${dream}`;
    dreams.unshift(dreamEntry);

    // Upload the updated list back
    await blockBlobClient.upload(JSON.stringify(dreams, null, 2), Buffer.byteLength(JSON.stringify(dreams, null, 2)));

    context.res = {
      status: 200,
      body: {
        message: `💭 Dream logged successfully: "${dreamEntry}"`
      }
    };
  } catch (err) {
    context.log.error("💥 Failed to log dream:", err.message);
    context.res = {
      status: 500,
      body: { error: "Failed to save dream." }
    };
  }
};

// Helper to convert stream to string
async function streamToString(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on("data", (data) => {
      chunks.push(data.toString());
    });
    readableStream.on("end", () => {
      resolve(chunks.join(""));
    });
    readableStream.on("error", reject);
  });
}
