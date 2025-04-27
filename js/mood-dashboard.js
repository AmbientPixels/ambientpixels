// NO import here!

document.addEventListener('DOMContentLoaded', function () {
  const refreshButton = document.getElementById('refresh-btn');

  refreshButton.addEventListener('click', refreshMood);

  async function refreshMood() {
    try {
      const response = await axios.get('/api/synthesizenovamood');
      const data = response.data;
  
      document.getElementById('mood').textContent = data.mood || 'Unknown';
      document.getElementById('aura').textContent = data.aura || 'Unknown';
      document.getElementById('quote').textContent = data.quote || 'No quote';
      document.getElementById('timestamp').textContent = new Date().toLocaleTimeString();
    } catch (error) {
      console.error('Error refreshing mood:', error);
    }
  }
});
