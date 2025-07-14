// DeviantArt Configuration
const DEVART_CONFIG = {
    clientId: '49816',
    clientSecret: process.env.DEVART_CLIENT_SECRET || '',
    username: 'NovaAmbient',
    maxItems: 5,
    apiUrl: 'https://ambientpixels-nova-api.azurewebsites.net/api/deviantartproxy/gallery',
    authEndpoint: 'https://www.deviantart.com/oauth2/authorize',
    tokenEndpoint: 'https://ambientpixels-nova-api.azurewebsites.net/api/deviantartproxy/token',
    redirectUri: 'https://ambientpixels.ai/lab/deviantart-feed.html',
    scopes: 'basic user submit read',
    galleryEndpoint: 'https://www.deviantart.com/api/v1/oauth2/gallery/all'
};

export default DEVART_CONFIG;
