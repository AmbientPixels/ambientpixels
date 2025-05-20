// DeviantArt Feed Module for Nova
// Uses DeviantArt API v1.0

import DEVART_CONFIG from './deviantart-config.js';

// DOM Elements and Authentication State
let feedContainer;
let accessToken = localStorage.getItem('deviantart_access_token');
let tokenExpiration = localStorage.getItem('deviantart_token_expiration');

// Initialize feed when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    feedContainer = document.getElementById('deviantart-feed-container');
    if (!feedContainer) {
        console.error('DeviantArt feed container not found');
        return;
    }
    
    // Show loading state using Nova's existing styles
    const loadingState = feedContainer.querySelector('.loading-state');
    if (loadingState) {
        loadingState.classList.remove('hidden');
    }
    
    try {
        // Initialize OAuth and fetch data
        const token = await initializeOAuth();
        if (!token) {
            throw new Error('Authorization required');
        }
        await initializeDeviantArtFeed();
    } catch (error) {
        console.error('Error initializing feed:', error);
        const errorState = feedContainer.querySelector('.error-state');
        if (errorState) {
            errorState.classList.remove('hidden');
            errorState.querySelector('#error-message').textContent = error.message || 'Error loading feed';
        }
    }
});

// Initialize OAuth flow
async function initializeOAuth() {
    try {
        // Check if we have a valid token
        const token = localStorage.getItem('deviantart_access_token');
        const expiration = localStorage.getItem('deviantart_token_expiration');
        
        if (!token || !expiration || Date.now() >= parseInt(expiration)) {
            // Token expired or doesn't exist, show authorization button
            const authButton = document.createElement('button');
            authButton.className = 'deviantart-auth-button nova-button';
            authButton.innerHTML = '<i class="fas fa-sign-in-alt"></i> Authorize with DeviantArt';
            authButton.onclick = () => {
                const authUrl = `${DEVART_CONFIG.authEndpoint}?client_id=${DEVART_CONFIG.clientId}&response_type=code&redirect_uri=${encodeURIComponent(DEVART_CONFIG.redirectUri)}&scope=basic`;
                window.location.href = authUrl;
            };
            
            // Clear any existing content
            feedContainer.innerHTML = '';
            feedContainer.appendChild(authButton);
            return null;
        }
        return token;
    } catch (error) {
        console.error('OAuth initialization error:', error);
        throw error; // Let the main flow handle this error
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
