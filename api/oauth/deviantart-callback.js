const express = require('express');
const router = express.Router();

// Handle DeviantArt OAuth callback
router.get('/callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) {
            return res.status(400).json({ error: 'No authorization code provided' });
        }

        // Exchange authorization code for access token
        const tokenResponse = await fetch('https://www.deviantart.com/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: process.env.DEVART_CLIENT_ID,
                client_secret: process.env.DEVART_CLIENT_SECRET,
                code: code,
                redirect_uri: 'https://ambientpixels.ai/callback'
            })
        });

        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) {
            return res.status(400).json({ error: 'Failed to get access token' });
        }

        // Store the access token securely (e.g., in session or database)
        // For now, we'll just return it
        res.json({
            success: true,
            access_token: tokenData.access_token,
            expires_in: tokenData.expires_in
        });
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
