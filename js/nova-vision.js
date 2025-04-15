// File: /js/nova-vision.js

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("imagePromptForm");
  const input = document.getElementById("promptInput");
  const imageContainer = document.getElementById("imageResult");
  const imageTag = document.getElementById("generatedImage");

  // Load NOVAVISION_KEY from injected API script
  await loadNovaVisionKey();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const prompt = input.value.trim();
    if (!prompt || !window.NOVAVISION_KEY) return;

    imageContainer.classList.remove("hidden");
    imageTag.src = "";
    imageTag.alt = "Generating...";

    try {
      const response = await fetch("/api/novavision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-functions-key": window.NOVAVISION_KEY
        },
        body: JSON.stringify({ prompt })
      });

      const data = await response.json();
      if (data && data.imageUrl) {
        imageTag.src = data.imageUrl;
        imageTag.alt = prompt;
      } else {
        imageTag.alt = "No image returned.";
      }
    } catch (err) {
      imageTag.alt = "Error generating image.";
      console.error("Image generation failed:", err);
    }
  });

  async function loadNovaVisionKey() {
    try {
      const script = document.createElement("script");
      script.src = "/api/config/index.js";
      document.head.appendChild(script);
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
      });
    } catch (err) {
      console.warn("Failed to load NOVAVISION_KEY.");
    }
  }
});
