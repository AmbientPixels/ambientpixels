// C:\ambientpixels\EchoGrid\api\synthesizeNovaMood\index.js
const { BlobServiceClient } = require('@azure/storage-blob');
const callGemini = require("../_utils/callGemini");

module.exports = async function (context, req) {
  const timestamp = new Date().toISOString();
  context.log(`[Nova Mood Engine] Mood generation started at ${timestamp}`);

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    context.log.error("❌ AZURE_STORAGE_CONNECTION_STRING is not set.");
    context.res = { status: 500, body: { error: "Storage configuration missing." } };
    return;
  }

  const containerName = 'nova-memory';
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  const telemetry = {
    githubStatus: "green",
    apiHealth: "stable",
    recentActivity: "commit and image generation",
    timeOfDay: new Date().getHours()
  };

  const inputText = `
    Nova's system status:
    - GitHub: ${telemetry.githubStatus}
    - API: ${telemetry.apiHealth}
    - Recent Activity: ${telemetry.recentActivity}
    - Time of Day: ${telemetry.timeOfDay}
  `.trim();

  try {
    const moodSummary = await callGemini(inputText);
    if (!moodSummary) {
      throw new Error("Gemini returned no output.");
    }
    context.log("[NovaSoul] Gemini output:", moodSummary);

    const label = moodSummary.toLowerCase();
    let mood = "neutral";
    if (label.includes("joy")) mood = "joy";
    else if (label.includes("sad")) mood = "sadness";
    else if (label.includes("anger")) mood = "anger";

    const moodOutput = {
      mood,
      timestamp,
      githubStatus: telemetry.githubStatus,
      confidence: 0.9,
      insights: generateMoodInsights({ mood }) // Include insights
    };

    const blobName = `nova-mood-${timestamp}.json`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const moodData = Buffer.from(JSON.stringify(moodOutput, null, 2));
    const uploadBlobResponse = await blockBlobClient.uploadData(moodData, {
      blobHTTPHeaders: { blobContentType: "application/json" }
    });
    context.log(`Blob storage upload successful: ${uploadBlobResponse.requestId}`);

    context.res = {
      status: 200,
      body: moodOutput
    };
  } catch (err) {
    context.log.error("❌ Mood generation failed:", err.message);
    context.res = {
      status: 500,
      body: { error: "Unable to synthesize mood." }
    };
  }
};

function generateMoodInsights(moodOutput) {
  const { mood } = moodOutput;
  let insight = `Nova is feeling ${mood}.`;
  if (mood === "joy") insight += " High energy and creativity detected.";
  else if (mood === "sadness") insight += " A moment of introspection.";
  else if (mood === "anger") insight += " Possible frustration in the system.";
  else if (mood === "neutral") insight += " Stable mood with balanced energy.";
  return insight;
}