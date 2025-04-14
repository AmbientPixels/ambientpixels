// File: /js/nova-insights.js

// Simulate Nova-generated insights for project cards
// Future: Hook into mood drift, changelog scans, or trend analysis

function generateNovaInsight(project) {
  const { title, status, tags = [], progress = 0, lastUpdated } = project;
  const now = new Date();
  const last = new Date(lastUpdated);
  const daysOld = Math.floor((now - last) / (1000 * 60 * 60 * 24));

  let insight = `"${title}" is currently marked as ${status}. `;

  // Momentum
  if (progress >= 0.8) {
    insight += "It’s nearing completion. 🚀 ";
  } else if (progress >= 0.5) {
    insight += "Steady momentum—about halfway through. 📈 ";
  } else if (progress > 0) {
    insight += "It’s just getting off the ground. ✍ ";
  } else if (status === 'Planned') {
    insight += "Still on the launchpad. 🧪 ";
  }

  // Last updated
  if (daysOld > 14) {
    insight += `Note: It hasn’t been updated in ${daysOld} days. Nova is growing... concerned. 🤖💤`;
  }

  return insight;
}

// Example usage:
// const insights = projects.map(generateNovaInsight);
// console.log(insights);
// Later: Inject into dashboard card UI or logs automatically
