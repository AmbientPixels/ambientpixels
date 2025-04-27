const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = 'nova-memory'; // Replace with your container name
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  const insights = [];

  try {
    // Fetch recent mood blobs (Limit to 10 recent blobs for performance)
    const blobs = containerClient.listBlobsFlat();
    let count = 0;

    for await (const blob of blobs) {
      if (count >= 10) break; // Limit to 10 blobs for performance
      const blobClient = containerClient.getBlobClient(blob.name);
      const downloadBlockBlobResponse = await blobClient.download();
      const data = await streamToText(downloadBlockBlobResponse.readableStreamBody);

      // Analyze data for insights
      const moodData = JSON.parse(data);
      if (moodData?.mood) {
        if (moodData.mood === "glitchy joy") {
          insights.push("High creativity detected.");
        } else if (moodData.mood === "calm circuit") {
          insights.push("Stable mood with low energy.");
        }
        // Add more mood-specific insights as needed
      }
      count++;
    }

    context.res = {
      status: 200,
      body: {
        insights,
        message: "Mood insights generated successfully."
      }
    };
  } catch (err) {
    context.log.error("Error generating mood insights:", err.message);
    context.res = {
      status: 500,
      body: { error: "Failed to generate mood insights." }
    };
  }
};

// Helper function to convert stream to text
async function streamToText(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', chunk => chunks.push(chunk));
    readableStream.on('end', () => resolve(Buffer.concat(chunks).toString()));
    readableStream.on('error', reject);
  });
}
