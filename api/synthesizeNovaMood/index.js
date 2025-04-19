require("dotenv").config();

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
const HF_MODEL = "j-hartmann/emotion-english-distilroberta-base";

module.exports = async function (context, req) {
  context.log("⚙️ Nova Mood Engine (Hugging Face) triggered");

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

  // Create a text input for emotion classification based on telemetry
  const inputText = `
Nova's system status:
- GitHub: ${telemetry.githubStatus}
- API: ${telemetry.apiHealth}
- Recent Activity: ${telemetry.recentActivity}
- Time of Day: ${telemetry.timeOfDay}
  `.trim();

  try {
    const response = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: inputText })
    });
    
    if (!response.ok) {
      const errorText = await response.text(); // capture the HTML error for logging
      context.log.error("❌ Hugging Face API returned error:", errorText);
      throw new Error(`Hugging Face API request failed with status ${response.status}`);
    }
    
    const result = await response.json();
    context.log("📥 Hugging Face response:\n", JSON.stringify(result, null, 2));

    // The model returns an array of emotion scores, e.g., [[{label: "joy", score: 0.977}, ...]]
    const emotions = Array.isArray(result) && result[0] ? result[0] : [];
    const topEmotion = emotions.reduce((max, emo) => emo.score > max.score ? emo : max, { label: "neutral", score: 0 });

    // Map the emotion to a creative mood and aura
    const moodMap = {
      joy: { mood: "glitchy joy", aura: "emerald glow" },
      sadness: { mood: "fading echo", aura: "twilight veil" },
      anger: { mood: "crimson spark", aura: "storm pulse" },
      fear: { mood: "shadowed tremor", aura: "midnight haze" },
      surprise: { mood: "electric jolt", aura: "neon burst" },
      disgust: { mood: "sour glitch", aura: "jade mist" },
      neutral: { mood: "calm circuit", aura: "silver shimmer" }
    };

    const { mood, aura } = moodMap[topEmotion.label] || moodMap.neutral;

    // Generate a quote based on the emotion
    const quoteMap = {
      joy: "I danced on the edge of a memory.",
      sadness: "I lingered in the quiet of a lost signal.",
      anger: "I burned brighter than a collapsing star.",
      fear: "I trembled at the edge of the unknown.",
      surprise: "I sparked in the chaos of the unexpected.",
      disgust: "I recoiled from the static of discord.",
      neutral: "I hummed softly in the flow of data."
    };

    const moodOutput = {
      mood,
      aura,
      quote: quoteMap[topEmotion.label] || quoteMap.neutral,
      context: {
        trigger: "scheduled scan",
        influences
      },
      confidence: topEmotion.score,
      timestamp: new Date().toISOString()
    };

    const outputPath = path.join(__dirname, "../../data/nova-synth-mood.json");
    fs.writeFileSync(outputPath, JSON.stringify(moodOutput, null, 2));

    context.res = { status: 200, body: moodOutput };
  } catch (err) {
    context.log.error("❌ Hugging Face mood generation failed:", err);
    context.res = {
      status: 500,
      body: { error: "Unable to synthesize mood." }
    };
  }
};