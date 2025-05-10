// \EchoGrid\scripts\generateDailyLogs.js
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const outputFile = path.join(__dirname, "../data/daily-logs.json");

function getRecentCommits(limit = 3) {
  try {
    const log = execSync(`git log -n ${limit} --pretty=format:"%ad|%s" --date=iso`, { encoding: "utf8" });
    return log.split("\n").map(line => {
      const [date, message] = line.split("|");
      const timestamp = date.slice(0, 16).replace("T", " ");
      return { timestamp, message };
    });
  } catch (err) {
    console.error("❌ Failed to read Git history", err);
    return [];
  }
}

function getSystemEvents() {
  return [
    "NovaMood engine recalibrated for enhanced signal clarity.",
    "Awareness dashboard synced with latest telemetry data.",
    "Thought synthesis panel optimized for emotional resonance.",
    "MoodScan.js updated with new input vectors.",
    "API monitor reported stable endpoint performance.",
    "Code footprint analysis completed successfully.",
    "New AI prompt generated for creative spark.",
    "Nova's dream archive expanded with fresh entries.",
    "System transparency metrics recalculated."
  ];
}

function getFileModifiedTime(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.mtime.toISOString().slice(0, 16).replace("T", " ");
  } catch (err) {
    return null;
  }
}

function generateDailyLogs() {
  const baseTime = new Date();
  const result = [];
  const usedMessages = [];

  // Add Git commits (real timestamps)
  const commits = getRecentCommits(3);
  commits.forEach(({ timestamp, message }) => {
    if (!usedMessages.includes(message)) {
      result.push({ timestamp, message });
      usedMessages.push(message);
    }
  });

  // Add system events with real or Workflow-based timestamps
  const events = getSystemEvents();
  const needed = Math.floor(Math.random() * 3) + 4 - result.length; // 4–6 total
  const filePaths = [
    "../data/mood-scan.json",
    "../data/nova-dreams.json",
    "../data/ai-prompts.json",
    "../data/api-monitor.json"
  ].map(p => path.join(__dirname, p));

  for (let i = 0; i < needed; i++) {
    const availableEvents = events.filter(event => !usedMessages.includes(event));
    if (availableEvents.length === 0) break;
    const message = availableEvents[Math.floor(Math.random() * availableEvents.length)];
    usedMessages.push(message);

    // Try file modification time
    let timestamp = i < filePaths.length ? getFileModifiedTime(filePaths[i]) : null;
    if (!timestamp) {
      // Use Workflow execution time with offset
      const offsetSeconds = i * 10; // Slight offset to avoid duplicates
      const logTime = new Date(baseTime.getTime() - offsetSeconds * 1000);
      timestamp = logTime.toISOString().slice(0, 16).replace("T", " ");
    }

    result.push({ timestamp, message });
  }

  // Sort by timestamp (descending)
  return result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

try {
  fs.writeFileSync(outputFile, JSON.stringify(generateDailyLogs(), null, 2));
  console.log(`✅ Daily logs written to /data/daily-logs.json`);
} catch (err) {
  console.error(`❌ Failed to write /data/daily-logs.json: ${err.message}`);
  process.exit(1);
}