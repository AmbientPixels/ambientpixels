/**
 * CSRF Protection Utility for CardForge API
 * Created: 2025-07-05
 * 
 * Provides middleware functions to validate CSRF tokens
 */

/**
 * Validates the CSRF token in the request headers
 * @param {object} req - HTTP request object
 * @param {object} context - Azure Function context
 * @returns {boolean} - True if token is valid, false otherwise
 */
function validateCSRFToken(req, context) {
    // Skip validation for non-mutating methods
    const nonMutatingMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (nonMutatingMethods.includes(req.method)) {
        return true;
    }

    // Check for token in headers
    const token = req.headers['x-csrf-token'];
    if (!token) {
        context.log.warn('CSRF validation failed: Missing token');
        return false;
    }

    // Validate token format
    const tokenRegex = /^[A-Za-z0-9]{32}$/;
    if (!tokenRegex.test(token)) {
        context.log.warn('CSRF validation failed: Invalid token format');
        return false;
    }

    // For stronger security, this could be enhanced with:
    // 1. Double-submit cookie validation
    // 2. Token storage in a database or session store
    // 3. Token expiration checks
    
    // Token passes basic validation
    return true;
}

/**
 * Middleware to protect against CSRF attacks
 * @param {object} context - Azure Function context
 * @param {object} req - HTTP request object 
 * @returns {object|null} - Error response or null if validation passes
 */
function csrfProtection(context, req) {
    if (!validateCSRFToken(req, context)) {
        return {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'CSRF token validation failed',
                message: 'Invalid or missing CSRF token'
            })
        };
    }
    return null;
}

module.exports = {
    validateCSRFToken,
    csrfProtection
};
