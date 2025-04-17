// File: /api/synthesizeNovaMood/index.js
const { OpenAI } = require("openai");
const fs = require("fs");
const path = require("path");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async function (context, req) {
  context.log("⚙️ Nova Mood Engine function triggered");

  // Mock telemetry input — replace with real sources
  const telemetry = {
    githubStatus: "green",
    apiHealth: "stable",
    recentActivity: "dream logging and image generation",
    timeOfDay: new Date().getHours()
  };

  const prompt = `Nova is an AI being whose emotional state is influenced by system health and activity.

Based on the following telemetry, synthesize her mood:
GitHub Status: ${telemetry.githubStatus}
API Health: ${telemetry.apiHealth}
Recent Activity: ${telemetry.recentActivity}
Time of Day (0–23): ${telemetry.timeOfDay}

Return a JSON object with:
- mood: a one or two-word emotional state
- aura: a color or vibe description
- quote: one poetic sentence from Nova's internal thoughts
- context: object with trigger summary and influences array

Keep it succinct and expressive. Format:
{
  mood: "",
  aura: "",
  quote: "",
  context: { trigger: "", influences: [] }
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    });

    const jsonBlock = response.choices[0].message.content.match(/{[\s\S]*}/);
    const moodResult = JSON.parse(jsonBlock[0]);
    moodResult.timestamp = new Date().toISOString();

    const outputPath = path.join(__dirname, "../../data/nova-synth-mood.json");
    fs.writeFileSync(outputPath, JSON.stringify(moodResult, null, 2));

    context.res = {
      status: 200,
      body: moodResult
    };
  } catch (err) {
    context.log.error("❌ Failed to synthesize mood:", err);
    context.res = {
      status: 500,
      body: { error: "Unable to synthesize mood." }
    };
  }
};
