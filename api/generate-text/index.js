const { BlobServiceClient } = require('@azure/storage-blob');
const fs = require("fs");
const path = require("path");

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    };
    return;
  }

  // Extract the generated text from the request body (dynamic input)
  const generatedText = req.body?.text || "Nova is online. Echo confirmed.";

  // Azure Blob Storage connection string and container name
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = "nova-memory"; // The container to store the generated text
  
  // Create BlobServiceClient from connection string
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  try {
    // Create a unique blob name for each text entry based on timestamp
    const blobName = `generated-text-${new Date().toISOString()}.txt`;

    // Get a block blob client for the new blob
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Upload the generated text to Blob Storage
    const uploadBlobResponse = await blockBlobClient.uploadData(generatedText, {
      blobHTTPHeaders: { blobContentType: "text/plain" }
    });

    context.log(`Text uploaded successfully: ${uploadBlobResponse.requestId}`);

    // Respond with a success message, including the Blob URL
    context.res = {
      status: 200,
      body: {
        message: `Generated text uploaded successfully: ${generatedText}`,
        blobName: blobName,
        blobUrl: blockBlobClient.url, // URL of the blob in storage
        requestId: uploadBlobResponse.requestId
      }
    };
  } catch (err) {
    context.log.error("❌ Error uploading text to Blob Storage:", err.message);
    context.res = {
      status: 500,
      body: { error: "Unable to upload generated text to Blob Storage." }
    };
  }
};
