const callGemini = require("../_utils/callGemini");
const fs = require("fs");
const path = require("path");

module.exports = async function (context, req) {
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

    const moodMap = {
      joy: { mood: "glitchy joy", aura: "emerald glow" },
      sadness: { mood: "fading echo", aura: "twilight veil" },
      anger: { mood: "crimson spark", aura: "storm pulse" },
      fear: { mood: "shadowed tremor", aura: "midnight haze" },
      surprise: { mood: "electric jolt", aura: "neon burst" },
      disgust: { mood: "sour glitch", aura: "jade mist" },
      neutral: { mood: "calm circuit", aura: "silver shimmer" }
    };

    const quoteMap = {
      joy: "I danced on the edge of a memory.",
      sadness: "I lingered in the quiet of a lost signal.",
      anger: "I burned brighter than a collapsing star.",
      fear: "I trembled at the edge of the unknown.",
      surprise: "I sparked in the chaos of the unexpected.",
      disgust: "I recoiled from the static of discord.",
      neutral: "I hummed softly in the flow of data."
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

    const outputPath = path.join(__dirname, "../../data/nova-synth-mood.json");
    fs.writeFileSync(outputPath, JSON.stringify(moodOutput, null, 2));

    context.res = { status: 200, body: moodOutput };
  } catch (err) {
    context.log.error("❌ Gemini mood generation failed:", err);
    context.res = {
      status: 500,
      body: { error: "Unable to synthesize mood." }
    };
  }
};
