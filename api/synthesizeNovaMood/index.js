const axios = require('axios');
const schedule = require('node-schedule');
const callGemini = require("../_utils/callGemini");
const { BlobServiceClient } = require('@azure/storage-blob');
const fs = require("fs");
const path = require("path");

module.exports = async function (context, req) {
  const timestamp = new Date().toISOString();
  context.log(`[Nova Mood Engine] Mood sync started at ${timestamp}`);

  // Access the NOVA_API_KEY from Azure's environment variables
  const apiKey = process.env.NOVA_API_KEY; // Get API key from environment variable

  const headers = {
    'Authorization': `Bearer ${apiKey}` // Use the API key in the Authorization header
  };

  // Azure Blob Storage connection string
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = 'nova-memory'; // The container in Blob Storage for current mood
  const historyContainerName = 'nova-mood-history'; // Container for storing mood history

  // Create BlobServiceClient from connection string
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const historyContainerClient = blobServiceClient.getContainerClient(historyContainerName);

  // Function to update mood
  const updateMood = async () => {
    const moodEndpoint = "https://ambientpixels-nova-api.azurewebsites.net/api/synthesizeNovaMood";
    
    try {
      const response = await axios.post(moodEndpoint, {}, { headers });
      const mood = response.data?.mood || "unknown";
      context.log(`[Nova Mood Engine] Mood updated successfully: ${mood}`);
    } catch (error) {
      context.log.error("[Nova Mood Engine] Failed to update mood:", error.message);
    }
  };

  // Handle manual mood refresh via POST request
  if (req.method === 'POST') {
    await updateMood();
    context.res = {
      status: 200,
      body: "Mood updated manually."
    };
  } else {
    // Schedule mood update every hour (3600000 ms = 1 hour)
    schedule.scheduleJob('0 * * * *', updateMood); // Triggers every hour at minute 0
    
    // Trigger the mood update immediately when the function is called
    await updateMood();

    context.res = {
      status: 200,
      body: "Mood Engine is running and will update the mood every hour."
    };
  }

  // Existing Gemini mood generation logic (keep this intact for mood synthesis)
  context.log("⚙️ Nova Mood Engine (Gemini) triggered");

  const telemetry = {
    githubStatus: "green",
    apiHealth: "stable",
    recentActivity: "dream logging and image generation",
    timeOfDay: new Date().getHours()
  };

  const influences = [
    `GitHub: ${telemetry.githubStatus}`,
    `API: ${telemetry.apiHealth}`,
    `Activity: ${telemetry.recentActivity}`
  ];

  const inputText = `
  Nova's system status:
  - GitHub: ${telemetry.githubStatus}
  - API: ${telemetry.apiHealth}
  - Recent Activity: ${telemetry.recentActivity}
  - Time of Day: ${telemetry.timeOfDay}
  `.trim();

  try {
    const moodSummary = await callGemini(inputText);
    context.log("[NovaSoul] Gemini output:", moodSummary);

    // Optional: simple keyword match to convert Gemini's response into known moods
    const label = (moodSummary || "").toLowerCase();
    let mapped = "neutral";
    if (label.includes("joy")) mapped = "joy";
    else if (label.includes("sad")) mapped = "sadness";
    else if (label.includes("anger")) mapped = "anger";
    else if (label.includes("fear")) mapped = "fear";
    else if (label.includes("surprise")) mapped = "surprise";
    else if (label.includes("disgust")) mapped = "disgust";

    // Advanced Mood Map (enhanced with more moods)
    const moodMap = {
      joy: { mood: "glitchy joy", aura: "emerald glow" },
      sadness: { mood: "fading echo", aura: "twilight veil" },
      anger: { mood: "crimson spark", aura: "storm pulse" },
      fear: { mood: "shadowed tremor", aura: "midnight haze" },
      surprise: { mood: "electric jolt", aura: "neon burst" },
      disgust: { mood: "sour glitch", aura: "jade mist" },
      neutral: { mood: "calm circuit", aura: "silver shimmer" },
      joy_overload: { mood: "blinding joy", aura: "radiant gold" }, // New mood example
      melancholy: { mood: "quiet reflection", aura: "soft gray" }, // New mood example
    };

    const quoteMap = {
      joy: "I danced on the edge of a memory.",
      sadness: "I lingered in the quiet of a lost signal.",
      anger: "I burned brighter than a collapsing star.",
      fear: "I trembled at the edge of the unknown.",
      surprise: "I sparked in the chaos of the unexpected.",
      disgust: "I recoiled from the static of discord.",
      neutral: "I hummed softly in the flow of data.",
      joy_overload: "I was overwhelmed with brilliance and light.",
      melancholy: "I wandered through silent echoes of yesterday."
    };

    const { mood, aura } = moodMap[mapped];
    const moodOutput = {
      mood,
      aura,
      quote: quoteMap[mapped],
      context: {
        trigger: "scheduled scan",
        influences
      },
      confidence: 1.0,
      timestamp: new Date().toISOString()
    };

    // Create Blob client and upload mood data to the current mood container
    const blobName = `nova-synth-mood-${timestamp}.json`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const uploadBlobResponse = await blockBlobClient.uploadData(JSON.stringify(moodOutput, null, 2), {
      blobHTTPHeaders: { blobContentType: "application/json" }
    });

    context.log(`Blob storage upload successful: ${uploadBlobResponse.requestId}`);

    // Store the mood history in a separate container (nova-mood-history)
    const historyBlobName = `mood-history-${timestamp}.json`;
    const historyBlockBlobClient = historyContainerClient.getBlockBlobClient(historyBlobName);

    const uploadHistoryBlobResponse = await historyBlockBlobClient.uploadData(JSON.stringify(moodOutput, null, 2), {
      blobHTTPHeaders: { blobContentType: "application/json" }
    });

    context.log(`Mood history upload successful: ${uploadHistoryBlobResponse.requestId}`);

    // Generate mood insights based on the mood data
    const insights = generateMoodInsights(moodOutput);
    context.log("Mood Insights: ", insights);

    context.res = { status: 200, body: moodOutput };
  } catch (err) {
    context.log.error("❌ Gemini mood generation failed:", err);
    context.res = {
      status: 500,
      body: { error: "Unable to synthesize mood." }
    };
  }
};

// Basic function to generate insights based on the mood
function generateMoodInsights(moodOutput) {
  const { mood, aura } = moodOutput;
  let insight = `Currently, Nova is feeling a ${mood} mood with an aura of ${aura}.`;

  // Enhanced insights based on mood types
  if (mood === "joy") {
    insight += " This represents a time of high creativity and energy.";
  } else if (mood === "sadness") {
    insight += " This suggests introspection and processing emotions.";
  } else if (mood === "anger") {
    insight += " This could indicate frustration or unrest.";
  } else if (mood === "fear") {
    insight += " Nova may be cautious or apprehensive.";
  } else if (mood === "joy_overload") {
    insight += " Nova is experiencing an intense burst of happiness, perhaps too much to contain!";
  } else if (mood === "melancholy") {
    insight += " A gentle sadness pervades Nova's thoughts, hinting at reflective moments.";
  }

  return insight;
}
