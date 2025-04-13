// File: /js/nova-insights.js

// Simulate simple Nova-generated insights for each project based on progress, tags, and status
// In the future this can hook into real trend analysis or scan data

function generateNovaInsight(project) {
    const { title, status, tags, progress = null, lastUpdated } = project;
    const now = new Date();
    const last = new Date(lastUpdated);
    const daysSinceUpdate = Math.floor((now - last) / (1000 * 60 * 60 * 24));
  
    // Base comment
    let insight = `"${title}" is currently marked as ${status}. `;
  
    // Momentum clues
    if (progress >= 0.8) {
      insight += "It’s nearing completion. 🚀 ";
    } else if (progress >= 0.5) {
      insight += "Steady momentum—about halfway through. 📈 ";
    } else if (progress > 0) {
      insight += "It’s just getting off the ground. ✍️ ";
    } else if (status === 'Planned') {
      insight += "Still on the launchpad. 🧪 ";
    }
  
    // Update delay
    if (daysSinceUpdate > 14) {
      insight += `Note: It hasn’t been updated in ${daysSinceUpdate} days. Nova is growing... concerned. 🤖💤`;
    }
  
    return insight;
  }
  
  // Example usage:
  // const insights = projects.map(generateNovaInsight);
  // console.log(insights);
  
  // Future: Inject these into Nova dashboard logs or comment bubbles on cards
  