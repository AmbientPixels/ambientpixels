// File: /js/nova-background.js

document.addEventListener("NovaMoodUpdate", (e) => {
    const { mood = "neutral" } = e.detail || {};

    // Normalize and sanitize mood
    const moodClass = "bg-" + mood.toLowerCase().replace(/\s+/g, "-");

    // Clean up old bg-* classes only
    document.body.className = document.body.className
      .split(" ")
      .filter(cls => !cls.startsWith("bg-"))
      .join(" ")
      .trim();

    // Apply new background class to <body>
    document.body.classList.add(moodClass);

    console.log(`[Nova Background] Mood updated: ${moodClass}`);
});
