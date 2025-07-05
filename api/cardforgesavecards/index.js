const csrfValidator = require('../shared/csrf-validator');
const responseFormatter = require('../shared/response-formatter');
const authValidator = require('../shared/auth-validator');
const validationUtils = require('../shared/validation-utils');

module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request to savecards.');

    try {
        // Check for CSRF token first
        const csrfError = csrfValidator.csrfProtection(context, req);
        if (csrfError) {
            context.res = csrfError;
            return;
        }

        // Check Content-Type header
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('application/json')) {
            context.res = responseFormatter.formatError(415, "Content-Type must be application/json");
            return;
        }

        // Enhanced authentication check
        const authError = authValidator.requireAuthentication(context, req);
        if (authError) {
            context.res = authError;
            return;
        }

        // Get user info using our validator
        const userInfo = authValidator.getUserInfo(req, context);
        context.log('User authenticated:', userInfo.userDetails);

        // Validate request body exists
        if (!req.body) {
            context.res = responseFormatter.formatError(400, "Please pass card data in the request body");
            return;
        }

        const card = req.body;
        
        // Use centralized card validation
        const validationErrors = validationUtils.validateCard(card);
        
        // Add card ID validation (specific to this endpoint)
        if (!card.id) {
            validationErrors.push('Card ID is required');
        }
        
        // Return validation errors if any
        if (validationErrors.length > 0) {
            context.res = responseFormatter.formatValidationError(validationErrors);
            return;
        }
        
        // Sanitize card data and ensure it has userId from the authenticated user
        const sanitizedCard = validationUtils.sanitizeCard(card);
        sanitizedCard.userId = userInfo.userId || userInfo.userDetails;
        sanitizedCard.lastModified = new Date().toISOString();
        
        // Get existing cards
        let existingCards = context.bindings.inputBlob || [];
        
        // Update existing card or add new one
        const cardIndex = existingCards.findIndex(c => c.id === sanitizedCard.id);
        if (cardIndex >= 0) {
            existingCards[cardIndex] = { ...existingCards[cardIndex], ...sanitizedCard };
        } else {
            existingCards.push(sanitizedCard);
        }
        
        // Save cards
        context.bindings.outputBlob = existingCards;

        // Return standardized JSON response
        context.res = responseFormatter.formatSuccess({
            card: card
        }, "Card data saved successfully");
    } catch (error) {
        context.log.error('Error saving card:', error);
        const details = process.env.NODE_ENV === 'development' ? { message: error.message } : null;
        context.res = responseFormatter.formatError(500, "Internal server error", details);
    }
};
