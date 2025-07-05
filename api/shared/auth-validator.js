/**
 * Authentication Validator Utility for CardForge API
 * Created: 2025-07-05
 * 
 * Provides robust authentication and JWT validation functions for API endpoints
 */

const jwt = require('jsonwebtoken');

/**
 * Extract and verify user information from the client principal header
 * @param {object} req - HTTP request object
 * @param {object} context - Azure Function context
 * @returns {object|null} - User info object or null if authentication failed
 */
function getUserInfo(req, context) {
    try {
        // Check for principal header
        const principal = req.headers['x-ms-client-principal'];
        if (!principal) {
            context.log.warn('Authentication failed: Missing principal header');
            return null;
        }

        // Decode and parse the principal data
        const principalData = Buffer.from(principal, 'base64').toString('ascii');
        const userInfo = JSON.parse(principalData);

        // Basic validation of user info structure
        if (!userInfo || !userInfo.identityProvider || !userInfo.userDetails) {
            context.log.warn('Authentication failed: Invalid principal structure');
            return null;
        }

        return userInfo;
    } catch (error) {
        context.log.error('Authentication error:', error);
        return null;
    }
}

/**
 * Validate the JWT token if present in the request
 * @param {object} req - HTTP request object
 * @param {object} context - Azure Function context 
 * @returns {boolean} - True if token is valid or not required, false otherwise
 */
function validateToken(req, context) {
    // Skip validation for non-sensitive endpoints
    if (req.url && req.url.toLowerCase().includes('/gallery')) {
        return true;
    }

    try {
        // Check for authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            context.log.warn('JWT validation: No bearer token');
            return false;
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix
        
        // Get JWT verification settings
        const jwtConfig = getJwtConfig();
        
        // Verify the token with full signature validation
        try {
            // Verify token with provided secret or public key
            // This will throw an error if verification fails
            const verified = jwt.verify(token, jwtConfig.secret, {
                algorithms: jwtConfig.algorithms,
                audience: jwtConfig.audience,
                issuer: jwtConfig.issuer
            });
            
            // Additional custom validation can be done here
            // For example, check for required claims
            if (!verified.sub) {
                context.log.warn('JWT validation: Missing subject claim');
                return false;
            }
            
            return true;
        } catch (verifyError) {
            context.log.warn('JWT validation failed:', verifyError.message);
            return false;
        }
    } catch (error) {
        context.log.error('JWT validation error:', error);
        return false;
    }
}

/**
 * Get JWT configuration from environment variables or configuration file
 * @returns {object} - JWT configuration object
 */
function getJwtConfig() {
    // In production, these should come from secure environment variables
    // or Azure Key Vault, not hardcoded
    const config = {
        // For Azure Static Web Apps, we can use the signing key provided by the platform
        // or a custom key for enhanced security
        secret: process.env.JWT_SECRET_KEY || process.env.AZURE_SWA_JWT_SECRET,
        
        // For public key verification (RS256, ES256, etc.)
        publicKey: process.env.JWT_PUBLIC_KEY,
        
        // Use RS256 if using public/private key pair, or HS256 for shared secret
        algorithms: ['RS256', 'HS256'],
        
        // Expected values for audience and issuer claims
        audience: process.env.JWT_AUDIENCE || 'cardforge-api',
        issuer: process.env.JWT_ISSUER || 'https://ambientpixels.ai'
    };
    
    // Handle different signature verification methods based on available keys
    if (config.publicKey) {
        // Use public key if available (asymmetric)
        config.secret = config.publicKey;
    } else if (!config.secret) {
        // Fallback for development only - DO NOT USE IN PRODUCTION
        config.secret = 'cardforge-dev-secret-key';
    }
    
    return config;
}

/**
 * Complete authentication check middleware for API endpoints
 * @param {object} context - Azure Function context
 * @param {object} req - HTTP request object
 * @returns {object|null} - Error response object or null if authentication passes
 */
function requireAuthentication(context, req) {
    const userInfo = getUserInfo(req, context);
    if (!userInfo) {
        return {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Authentication required',
                message: 'You must be logged in to access this resource'
            })
        };
    }

    if (!validateToken(req, context)) {
        return {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Invalid authentication token',
                message: 'Your authentication token is invalid or expired'
            })
        };
    }

    return null;
}

module.exports = {
    getUserInfo,
    validateToken,
    requireAuthentication
};
