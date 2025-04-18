document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("imagePromptForm");
  const input = document.getElementById("promptInput");
  const imageContainer = document.getElementById("imageResult");
  const imageTag = document.getElementById("generatedImage");

  // Live Azure Function API URL
  const apiUrl = "https://ambientpixels-nova-api.azurewebsites.net/api/novavision";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const prompt = input.value.trim();
    if (!prompt) return;

    imageContainer.classList.remove("hidden");
    imageTag.src = "";
    imageTag.alt = "Generating...";

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
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
});
