// DeviantArt Feed Module for Nova
// Uses DeviantArt API v1.0

// Configuration
const DEVART_CONFIG = {
    clientId: process.env.DEVART_CLIENT_ID || 'YOUR_CLIENT_ID', // Replace with actual client ID
    clientSecret: process.env.DEVART_CLIENT_SECRET || 'YOUR_CLIENT_SECRET',
    username: 'NovaAmbient',
    maxItems: 5,
    apiUrl: 'https://www.deviantart.com/api/v1/oauth2/gallery/all',
    authEndpoint: 'https://www.deviantart.com/oauth2/authorize',
    redirectUri: 'https://ambientpixels.ai/callback'
};

// Fallback configuration if environment variables aren't loaded
if (!process.env.DEVART_CLIENT_ID || !process.env.DEVART_CLIENT_SECRET) {
    console.warn('DeviantArt credentials not found in environment variables. Using fallback configuration.');
}

// Initialize feed when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    feedContainer = document.getElementById('deviantart-feed-container');
    if (!feedContainer) {
        console.error('DeviantArt feed container not found');
        return;
    }
    await initializeDeviantArtFeed();
});

// Initialize OAuth flow
async function initializeOAuth() {
    try {
        // Check if we have a valid token
        if (!accessToken || !tokenExpiration || Date.now() >= parseInt(tokenExpiration)) {
            // Token expired or doesn't exist, show authorization button
            const authButton = document.createElement('button');
            authButton.className = 'deviantart-auth-button nova-button';
            authButton.innerHTML = '<i class="fas fa-sign-in-alt"></i> Authorize with DeviantArt';
            authButton.onclick = () => {
                const authUrl = `${DEVART_CONFIG.authEndpoint}?client_id=${DEVART_CONFIG.clientId}&response_type=code&redirect_uri=${encodeURIComponent(DEVART_CONFIG.redirectUri)}&scope=basic`;
                window.location.href = authUrl;
            };
            feedContainer.innerHTML = '';
            feedContainer.appendChild(authButton);
            return null;
        }
        return accessToken;
    } catch (error) {
        console.error('OAuth initialization error:', error);
        feedContainer.innerHTML = '<p class="error">Error initializing OAuth: ' + error.message + '</p>';
        return null;
    }
}

// Fetch Deviations
async function fetchDeviations() {
    try {
        const token = accessToken;
        if (!token) return [];

        const response = await fetch(`${DEVART_CONFIG.apiUrl}?username=${DEVART_CONFIG.username}&limit=${DEVART_CONFIG.maxItems}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('API request failed: ' + response.statusText);
        }
        
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error.message || 'API error occurred');
        }
        
        return data.results || [];
    } catch (error) {
        console.error('Error fetching deviations:', error);
        throw error; // Re-throw to handle in initializeDeviantArtFeed
    }
}

// Create Deviation Card
function createDeviationCard(deviation) {
    const card = document.createElement('div');
    card.className = 'deviation-card windsurf-fade-in';

    // Thumbnail
    const thumbnail = document.createElement('img');
    thumbnail.className = 'deviation-thumbnail';
    thumbnail.src = deviation.content.src;
    thumbnail.alt = deviation.title;
    card.appendChild(thumbnail);

    // Title
    const title = document.createElement('h3');
    title.className = 'deviation-title';
    title.textContent = deviation.title;
    card.appendChild(title);

    // Link
    const link = document.createElement('a');
    link.className = 'deviation-link';
    link.href = deviation.url;
    link.target = '_blank';
    link.textContent = 'View on DeviantArt';
    card.appendChild(link);

    // Tags/Mood (if available)
    if (deviation.tags && deviation.tags.length > 0) {
        const tags = document.createElement('div');
        tags.className = 'deviation-tags';
        deviation.tags.slice(0, 3).forEach(tag => {
            const tagElement = document.createElement('span');
            tagElement.className = 'tag';
            tagElement.textContent = tag;
            tags.appendChild(tagElement);
        });
        card.appendChild(tags);
    }

    return card;
}

// Initialize Feed
async function initializeDeviantArtFeed() {
    try {
        const deviations = await fetchDeviations();
        if (deviations.length === 0) {
            feedContainer.innerHTML = '<p class="no-content">No recent deviations found.</p>';
            return;
        }

        deviations.forEach(deviation => {
            const card = createDeviationCard(deviation);
            feedContainer.appendChild(card);
        });
    } catch (error) {
        console.error('Error initializing feed:', error);
        feedContainer.innerHTML = '<p class="error">Error loading DeviantArt feed.</p>';
    }
}

// Initialize feed when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('deviantart-feed-container');
    if (container) {
        container.appendChild(feedContainer);
        await initializeDeviantArtFeed();
    }
});

// Export initialization function for testing
export { initializeDeviantArtFeed };
