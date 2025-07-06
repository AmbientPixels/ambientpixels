// Simple response formatter function
function formatResponse(statusCode, body) {
    return {
        status: statusCode,
        headers: {
            'Content-Type': 'application/json'
        },
        body: body
    };
}

// Simple error formatter function
function formatError(statusCode, message) {
    return formatResponse(statusCode, { error: message });
}

module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request to savecards.');

    try {
        // CSRF protection removed for simplicity

        // Check Content-Type header
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('application/json')) {
            context.res = formatError(415, "Content-Type must be application/json");
            return;
        }

        // Simple authentication using headers if available
        const userHeader = req.headers['x-ms-client-principal'];
        let username = 'anonymous';
        
        if (userHeader) {
            try {
                const userInfo = JSON.parse(Buffer.from(userHeader, 'base64').toString('ascii'));
                username = userInfo.userDetails || 'anonymous';
                context.log('User identified:', username);
            } catch (error) {
                context.log.warn('Failed to parse user info:', error.message);
            }
        }

        // User already identified above

        // Validate request body exists
        if (!req.body) {
            context.res = formatError(400, "Please pass card data in the request body");
            return;
        }

        const card = req.body;
        
        // Simple card validation
        const validationErrors = [];
        
        // Add card ID validation (specific to this endpoint)
        if (!card.id) {
            validationErrors.push('Card ID is required');
        }
        
        // Return validation errors if any
        if (validationErrors.length > 0) {
            context.res = formatError(400, "Card validation failed: " + validationErrors.join(', '));
            return;
        }
        
        // Simple card sanitization
        const sanitizedCard = JSON.parse(JSON.stringify(card)); // Deep clone
        sanitizedCard.userId = username;
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
        context.res = formatResponse(200, {
            card: card
        });
    } catch (error) {
        context.log.error('Error saving card:', error);
        const details = process.env.NODE_ENV === 'development' ? { message: error.message } : null;
        context.res = formatError(500, "Internal server error", details);
    }
};
