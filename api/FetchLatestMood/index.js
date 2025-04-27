const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
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
      context.res = {
        status: 404,
        body: { error: "No mood data found in nova-memory." }
      };
      return;
    }

    // Download and parse the latest blob
    const blobClient = containerClient.getBlobClient(latestBlob.name);
    const downloadResponse = await blobClient.download();
    const data = await streamToText(downloadResponse.readableStreamBody);
    const moodData = JSON.parse(data);

    context.res = {
      status: 200,
      body: moodData
    };
  } catch (error) {
    context.log.error("Error fetching mood:", error.message);
    context.res = {
      status: 500,
      body: { error: "Failed to fetch mood: " + error.message }
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