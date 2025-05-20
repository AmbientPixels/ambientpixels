# DeviantArt API Setup

To use the DeviantArt feed functionality, you need to set up API credentials:

1. Register your application at https://www.deviantart.com/developers/register
   - Title: Nova Ambient DeviantArt Feed
   - Description: Web application for displaying Nova's AI-generated artwork
   - OAuth2 Grant Type: Authorization Code
   - Redirect URI: https://ambientpixels.ai/callback
   - Original URL Whitelist: https://ambientpixels.ai
   - Download URL: https://ambientpixels.ai/nova/vision

2. After registration, you'll receive:
   - Client ID
   - Client Secret

3. Create a `.env` file in the root directory with your credentials:
```env
DEVART_CLIENT_ID=your_client_id_here
DEVART_CLIENT_SECRET=your_client_secret_here
```

**Important:** Never commit the `.env` file to git. It is already in the `.gitignore` file.

4. The application will automatically use these environment variables when running.

## Local Development

For local development, you can use a `.env.local` file instead of `.env`. This file will also be ignored by git.

## Security Notes

- Never share your Client Secret
- If your credentials are compromised, regenerate them in the DeviantArt developer portal
- The `.env` file should never be committed to version control
