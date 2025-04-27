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

    const insights = [];
    const blobs = [];

    // Collect blobs with timestamps
    for await (const blob of containerClient.listBlobsFlat()) {
      blobs.push({ name: blob.name, createdOn: new Date(blob.properties.createdOn) });
    }

    // Sort by createdOn (descending) and limit to 5
    blobs.sort((a, b) => b.createdOn - a.createdOn);
    const recentBlobs = blobs.slice(0, 5);

    // Process recent blobs
    for (const blob of recentBlobs) {
      const blobClient = containerClient.getBlobClient(blob.name);
      const downloadResponse = await blobClient.download();
      const data = await streamToText(downloadResponse.readableStreamBody);
      const moodData = JSON.parse(data);

      if (moodData?.mood) {
        const mood = moodData.mood.toLowerCase();
        if (mood === "joy") {
          insights.push("High energy and creativity detected.");
        } else if (mood === "sadness") {
          insights.push("A moment of introspection.");
        } else if (mood === "anger") {
          insights.push("Possible frustration in the system.");
        } else if (mood === "neutral") {
          insights.push("Stable mood with balanced energy.");
        }
      }
    }

    context.res = {
      status: 200,
      body: {
        insights: insights.length > 0 ? insights : ["No specific insights generated."],
        message: "Mood insights generated successfully."
      }
    };
  } catch (error) {
    context.log.error("Error generating mood insights:", error.message);
    context.res = {
      status: 500,
      body: { error: "Failed to generate mood insights: " + error.message }
    };
  }
};

async function streamToText(readableStream) {
  const chunks = [];
  for await (const chunk of readableStream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}