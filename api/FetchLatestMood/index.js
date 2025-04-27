const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = 'nova-memory'; // Replace with your container name
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  let latestMood = null;

  // Fetch the most recent mood data from the container
  for await (const blob of containerClient.listBlobsFlat()) {
    const blobClient = containerClient.getBlobClient(blob.name);
    const downloadBlockBlobResponse = await blobClient.download();
    const data = await streamToText(downloadBlockBlobResponse.readableStreamBody);

    const moodData = JSON.parse(data);
    latestMood = moodData; // Assuming the latest mood is the last one in the list

    break; // If you just need the most recent one, stop here
  }

  context.res = {
    status: 200,
    body: latestMood || { error: "No mood data found." }
  };
};
