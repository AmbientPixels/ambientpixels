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
    context.log('JavaScript HTTP trigger function processed a request to publish card.');

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

        // Validate request body
        if (!req.body) {
            context.res = responseFormatter.formatError(400, "Please provide a request body");
            return;
        }

        // Validate card ID
        if (!req.body.id) {
            context.res = responseFormatter.formatError(400, "Please provide a card ID");
            return;
        }

        // Check if card exists in user's cards first
        const userCards = context.bindings.inputUserBlob || [];
        const cardToPublish = userCards.find(card => card.id === req.body.id);
        
        // Check card ownership
        if (!cardToPublish) {
            context.res = responseFormatter.formatNotFoundError("Card not found in your collection");
            return;
        }

        // Verify card belongs to authenticated user
        if (cardToPublish.userId && 
            cardToPublish.userId !== userInfo.userId && 
            cardToPublish.userId !== userInfo.userDetails) {
            context.log.warn('Card ownership mismatch:', {
                cardUserId: cardToPublish.userId,
                requestUserId: userInfo.userId,
                requestUserDetails: userInfo.userDetails
            });
            context.res = responseFormatter.formatForbiddenError("You don't have permission to publish this card");
            return;
        }

        // Use centralized card validation for required fields
        const validationErrors = validationUtils.validateCard(cardToPublish);
        
        // Return validation errors if any
        if (validationErrors.length > 0) {
            context.res = responseFormatter.formatValidationError(validationErrors);
            return;
        }

        // Sanitize card data before publishing using central utility
        const sanitizedCard = validationUtils.sanitizeCard(cardToPublish);

        // Get existing gallery
        const gallery = context.bindings.inputGalleryBlob || [];
        
        // Prepare card with publish metadata
        const publishedCard = {
            ...sanitizedCard,
            publishDate: new Date().toISOString(),
            publishedBy: userInfo.userDetails || userInfo.userId
        };
        
        // Check if already published
        const existingIndex = gallery.findIndex(card => card.id === req.body.id);
        if (existingIndex >= 0) {
            // Update existing (preserve original publish date if available)
            const originalPublishDate = gallery[existingIndex].publishDate;
            gallery[existingIndex] = {
                ...publishedCard,
                publishDate: originalPublishDate || publishedCard.publishDate,
                lastUpdated: new Date().toISOString()
            };
        } else {
            // Add new
            gallery.push(publishedCard);
        }
        
        // Save to gallery
        context.bindings.outputGalleryBlob = gallery;

        // Return standardized JSON response
        context.res = responseFormatter.formatSuccess({
            card: publishedCard
        }, "Card published to gallery");
    } catch (error) {
        context.log.error('Error publishing card:', error);
        const details = process.env.NODE_ENV === 'development' ? { message: error.message } : null;
        context.res = responseFormatter.formatError(500, "Internal server error", details);
    }
};

// Helper function removed - now using validationUtils.sanitizeString
