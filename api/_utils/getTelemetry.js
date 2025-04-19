// File: /api/_utils/getTelemetry.js
const fs = require("fs");
const path = require("path");

module.exports = function getTelemetry() {
  let githubStatus = "unknown";
  let apiHealth = "unknown";
  let recentActivity = "none";
  let weather = "clear";

  // GitHub activity
  const gitLogPath = path.join(__dirname, "../../data/github-activity.log");
  if (fs.existsSync(gitLogPath)) {
    const gitLog = fs.readFileSync(gitLogPath, "utf-8");
    const commitsToday = (gitLog.match(/2025-04-18/g) || []).length;
    githubStatus = commitsToday > 5 ? "high" : commitsToday > 0 ? "low" : "idle";
  }

  // API health
  const apiStatusPath = path.join(__dirname, "../../data/api-health.json");
  if (fs.existsSync(apiStatusPath)) {
    const apiStatus = JSON.parse(fs.readFileSync(apiStatusPath, "utf-8"));
    apiHealth = apiStatus.overall || "unknown";
  }

  // Activity
  const dreamPath = path.join(__dirname, "../../data/dreamLog.json");
  const promptPath = path.join(__dirname, "../../data/ai-prompts.json");
  const dreamCount = fs.existsSync(dreamPath) ? JSON.parse(fs.readFileSync(dreamPath)).length : 0;
  const promptCount = fs.existsSync(promptPath) ? JSON.parse(fs.readFileSync(promptPath)).length : 0;
  recentActivity = `${promptCount} prompts, ${dreamCount} dreams`;

  // Weather
  const weatherPath = path.join(__dirname, "../../data/weather.json");
  if (fs.existsSync(weatherPath)) {
    const weatherData = JSON.parse(fs.readFileSync(weatherPath, "utf-8"));
    weather = weatherData.condition || "clear";
  }

  return {
    githubStatus,
    apiHealth,
    recentActivity,
    weather,
    timeOfDay: new Date().getHours()
  };
};
