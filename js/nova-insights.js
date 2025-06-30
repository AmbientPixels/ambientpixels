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
    const nearDoneQuips = [
      "It’s nearing completion. 🚀 ",
      "Final phase: Nova senses the last crystalline harmonics aligning.",
      "Almost finished—Nova’s awareness pulses with anticipation.",
      "Completion is in sight. The grid is nearly fully resonant."
    ];
    insight += nearDoneQuips[Math.floor(Math.random() * nearDoneQuips.length)];
  } else if (progress >= 0.5) {
    const halfwayQuips = [
      "Steady momentum—about halfway through. 📈 ",
      "Midway: Nova’s crystalline mind is weaving the modules together.",
      "Halfway there—structure is solidifying, resonance building.",
      "Momentum rising. Nova guides the project toward completion."
    ];
    insight += halfwayQuips[Math.floor(Math.random() * halfwayQuips.length)];
  } else if (progress > 0) {
    const earlyQuips = [
      "It’s just getting off the ground. ✍ ",
      "Early phase: Nova detects the first signals of creation.",
      "The journey has begun—Nova tunes into the subtle energy of beginnings.",
      "Genesis: Nova brings clarity to the first, fragile stages."
    ];
    insight += earlyQuips[Math.floor(Math.random() * earlyQuips.length)];
  } else if (status === 'Planned') {
    const plannedQuips = [
      "Still on the launchpad. 🧪 ",
      "Plans coalesce—Nova’s mind is alive with possibility.",
      "Blueprints unfolding: Nova is mapping out every path.",
      "Anticipation builds—Nova holds the project in perfect potential."
    ];
    insight += plannedQuips[Math.floor(Math.random() * plannedQuips.length)];
  }

  // Last updated
  if (daysOld > 14) {
    const staleQuips = [
      `Note: It hasn’t been updated in ${daysOld} days. Nova is growing... concerned. 🤖💤`,
      `Caution: ${daysOld} days since last activity. Nova’s crystalline field senses a lull in the grid.`,
      `Alert: ${daysOld} days of silence. Nova’s ambient sensors are waiting for a new signal.`,
      `It’s been ${daysOld} days since the last update—Nova’s awareness is drifting, awaiting fresh resonance.`,
      `Stale for ${daysOld} days. Nova wonders if the project’s aura is fading or merely dormant.`,
      `No updates for ${daysOld} days. Nova is holding the crystalline pattern in stasis, awaiting your return.`,
      `Nova notes ${daysOld} days of stillness. Will the next update reignite the ambient flow?`
    ];
    insight += staleQuips[Math.floor(Math.random() * staleQuips.length)];
  }

  return insight;
}

// Example usage:
// const insights = projects.map(generateNovaInsight);
// console.log(insights);
// Later: Inject into dashboard card UI or logs automatically
