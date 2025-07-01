// /api/loadCardData/index.js
const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
  // Get user ID from query parameter or header
  const userId = req.query.userId || req.headers['x-user-id'];
  if (!userId) {
    context.res = { status: 400, body: "No user ID provided." };
    return;
  }

  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) {
    context.res = { status: 500, body: "Azure Storage connection string not set." };
    return;
  }

  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(connStr);
    const containerClient = blobServiceClient.getContainerClient('cardforge');
    
    // Check if container exists
    const containerExists = await containerClient.exists();
    if (!containerExists) {
      context.res = { status: 404, body: "Card data not found." };
      return;
    }

    // Get the blob client for the card data
    const blockBlobClient = containerClient.getBlockBlobClient(`${userId}.json`);
    
    // Check if blob exists
    const blobExists = await blockBlobClient.exists();
    if (!blobExists) {
      context.res = { status: 200, body: [] }; // Return empty array if no data exists yet
      return;
    }

    // Download the blob content
    const downloadResponse = await blockBlobClient.download(0);
    const content = await streamToString(downloadResponse.readableStreamBody);
    
    try {
      const cardData = JSON.parse(content);
      context.res = { status: 200, body: cardData };
    } catch (parseError) {
      context.log.error("Error parsing JSON:", parseError);
      context.res = { status: 500, body: "Error parsing card data." };
    }
  } catch (err) {
    context.log.error("Error details:", err);
    context.res = { status: 500, body: `Error loading card data: ${err.message}` };
  }
};

// Helper function to convert stream to string
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
