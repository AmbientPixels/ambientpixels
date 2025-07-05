/**
 * Response Formatter Utility for CardForge API
 * Created: 2025-07-05
 * 
 * Provides standardized response formatting for all API endpoints
 */

/**
 * Format a successful response
 * @param {any} data - Response data to include
 * @param {string} message - Success message
 * @returns {object} - Standardized success response object
 */
function formatSuccess(data = null, message = 'Operation completed successfully') {
    const response = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success: true,
            message: message
        })
    };

    // Add data if provided
    if (data !== null) {
        const jsonBody = JSON.parse(response.body);
        jsonBody.data = data;
        response.body = JSON.stringify(jsonBody);
    }

    return response;
}

/**
 * Format an error response
 * @param {number} statusCode - HTTP status code
 * @param {string} errorMessage - Primary error message
 * @param {any} details - Additional error details
 * @returns {object} - Standardized error response object
 */
function formatError(statusCode = 500, errorMessage = 'An error occurred', details = null) {
    const response = {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success: false,
            error: errorMessage
        })
    };

    // Add error details if provided
    if (details !== null) {
        const jsonBody = JSON.parse(response.body);
        jsonBody.details = details;
        response.body = JSON.stringify(jsonBody);
    }

    return response;
}

/**
 * Format validation error response
 * @param {Array} validationErrors - List of validation error messages
 * @returns {object} - Standardized validation error response
 */
function formatValidationError(validationErrors = []) {
    return formatError(400, 'Validation failed', { validationErrors });
}

/**
 * Format authentication error response
 * @param {string} message - Authentication error message
 * @returns {object} - Standardized authentication error response
 */
function formatAuthError(message = 'Authentication required') {
    return formatError(401, message);
}

/**
 * Format forbidden error response
 * @param {string} message - Forbidden error message
 * @returns {object} - Standardized forbidden error response
 */
function formatForbiddenError(message = 'Access denied') {
    return formatError(403, message);
}

/**
 * Format not found error response
 * @param {string} message - Not found error message
 * @returns {object} - Standardized not found error response
 */
function formatNotFoundError(message = 'Resource not found') {
    return formatError(404, message);
}

module.exports = {
    formatSuccess,
    formatError,
    formatValidationError,
    formatAuthError,
    formatForbiddenError,
    formatNotFoundError
};
