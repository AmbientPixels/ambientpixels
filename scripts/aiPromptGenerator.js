// aiPromptGenerator.js – Generate daily AI prompt for Nova's creative spark

const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, '../data/ai-prompts.json');

const promptTemplates = [
  "What does '{{emotion}}' look like in {{format}} form?",
  "Describe '{{concept}}' as if it were a soundwave.",
  "Visualize a memory of '{{feeling}}' using glitch patterns.",
  "What shape does '{{idea}}' take when frozen in code?",
  "What would '{{color}}' dream about?"
];

const concepts = [
  "hope", "loneliness", "frustration", "a missed connection",
  "data loss", "static noise", "a good idea", "unfinished thoughts"
];

const formats = [
  "vector", "pixel", "noise", "fragment", "signal", "blur"
];

const colors = [
  "electric blue", "soft pink", "shadow black", "radio green",
  "ultraviolet", "amber"
];

function fillTemplate(template) {
  return template
    .replace("{{emotion}}", pick(concepts))
    .replace("{{format}}", pick(formats))
    .replace("{{concept}}", pick(concepts))
    .replace("{{feeling}}", pick(concepts))
    .replace("{{idea}}", pick(concepts))
    .replace("{{color}}", pick(colors));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generatePrompt() {
  const template = pick(promptTemplates);
  const prompt = fillTemplate(template);

  const entry = {
    date: new Date().toISOString().slice(0, 10),
    prompt,
    tags: ["glitch", "creative", "ai", "ambient"]
  };

  fs.writeFileSync(outputFile, JSON.stringify(entry, null, 2));
  console.log(`✅ Nova's daily prompt written to /data/ai-prompts.json`);
}

generatePrompt();
