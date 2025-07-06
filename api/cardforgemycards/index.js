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
    context.log('JavaScript HTTP trigger function processed a request to mycards.');

    try {
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
        context.log('User identified:', username);

        // Get pagination parameters from query string
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 20;
        const sort = req.query.sort || 'lastModified';
        const order = req.query.order || 'desc';
        const filter = req.query.filter;
        
        // Handle special case for single card access
        const cardId = req.query.cardId;
        if (cardId) {
            return handleSingleCardAccess(context, userInfo, cardId);
        }

        // Validate pagination parameters
        if (page < 1 || pageSize < 1 || pageSize > 100) {
            context.res = formatError(400, 'Invalid pagination parameters. Page must be >= 1 and pageSize must be between 1 and 100.');
            return;
        }

        // Get user's cards
        const allCards = context.bindings.inputBlob || [];

        // Filter cards if filter parameter is provided
        let filteredCards = allCards;
        if (filter) {
            const filterLower = filter.toLowerCase();
            filteredCards = allCards.filter(card => 
                (card.name && card.name.toLowerCase().includes(filterLower)) || 
                (card.class && card.class.toLowerCase().includes(filterLower)) ||
                (card.quote && card.quote.toLowerCase().includes(filterLower))
            );
        }

        // Sort cards based on sort and order parameters
        filteredCards.sort((a, b) => {
            const aValue = a[sort] || '';
            const bValue = b[sort] || '';
            
            if (order.toLowerCase() === 'asc') {
                return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
            } else {
                return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
            }
        });

        // Calculate total pages
        const totalItems = filteredCards.length;
        const totalPages = Math.ceil(totalItems / pageSize);

        // Apply pagination
        const startIndex = (page - 1) * pageSize;
        const paginatedCards = filteredCards.slice(startIndex, startIndex + pageSize);

        // Return paginated results with metadata
        context.res = formatResponse(200, {
            cards: paginatedCards,
            pagination: {
                page,
                pageSize,
                totalItems,
                totalPages,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1
            }
        });
    } catch (error) {
        context.log.error('Error retrieving user cards:', error);
        const details = process.env.NODE_ENV === 'development' ? { message: error.message } : null;
        context.res = formatError(500, 'Failed to retrieve user cards', details);
    }
};

/**
 * Handle request for a single card by ID
 * @param {object} context - Azure Function context
 * @param {object} userInfo - User information from authentication
 * @param {string} cardId - ID of the card to retrieve
 */
function handleSingleCardAccess(context, username, cardId) {
    // Get all user cards
    const allCards = context.bindings.inputBlob || [];
    
    // Find the requested card
    const card = allCards.find(c => c.id === cardId);
    
    if (!card) {
        context.res = formatError(404, 'Card not found');
        return;
    }
    
    // Verify card belongs to authenticated user
    if (card.userId && card.userId !== userInfo.userId && card.userId !== username) {
        context.log.warn('Card ownership mismatch:', {
            cardUserId: card.userId,
            requestUserId: userInfo.userId,
            requestUserDetails: userInfo.userDetails
        });
        context.res = formatError(403, "You don't have permission to access this card");
        return;
    }
    
    // Return the card
    context.res = formatResponse(200, { card });
}
