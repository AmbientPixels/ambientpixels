// C:\ambientpixels\EchoGrid\js\mood-dashboard.js

document.addEventListener('DOMContentLoaded', function () {
  const refreshButton = document.getElementById('refresh-btn');

  refreshButton.addEventListener('click', refreshMood);

  async function refreshMood() {
    console.log("🔁 Refreshing mood...");

    try {
      const response = await axios.get('/api/fetchLatestMood/');
      const data = response.data;
      console.log("✅ Mood data received:", data);

      document.getElementById('mood').textContent = data.mood || 'Unknown';
      document.getElementById('aura').textContent = data.githubStatus || '—';
      document.getElementById('quote').textContent = `Confidence: ${data.confidence ?? '—'}`;
      document.getElementById('timestamp').textContent = new Date(data.timestamp).toLocaleTimeString();
    } catch (error) {
      console.error('❌ Error refreshing mood:', error);
    }
  }
});
