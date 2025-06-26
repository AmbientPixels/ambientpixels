// /api/saveCardData/index.js
const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
  const cardData = req.body;
  if (!cardData) {
    context.res = { status: 400, body: "No card data provided." };
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
    await containerClient.createIfNotExists();

    const blockBlobClient = containerClient.getBlockBlobClient('card-forge.json');
    const content = JSON.stringify(cardData, null, 2);
    await blockBlobClient.upload(content, Buffer.byteLength(content), { overwrite: true });

    context.res = { status: 200, body: { success: true, message: "Card data saved to Azure." } };
  } catch (err) {
    context.log.error("Error details:", err);
    context.res = { status: 500, body: `Error saving card data: ${err.message}\n${err.stack}` };
  }
};
