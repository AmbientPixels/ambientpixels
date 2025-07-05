const responseFormatter = require('../shared/response-formatter');

module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request to gallery.');

    try {
        // Get pagination parameters from query string
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 20;
        const sort = req.query.sort || 'publishDate';
        const order = req.query.order || 'desc';
        const filter = req.query.filter;

        // Validate parameters
        if (page < 1 || pageSize < 1 || pageSize > 100) {
            context.res = responseFormatter.formatError(400, 'Invalid pagination parameters. Page must be >= 1 and pageSize must be between 1 and 100.');
            return;
        }

        // Get all published cards
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
        context.res = responseFormatter.formatSuccess({
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
        context.log.error('Error retrieving gallery cards:', error);
        const details = process.env.NODE_ENV === 'development' ? { message: error.message } : null;
        context.res = responseFormatter.formatError(500, 'Failed to retrieve gallery cards', details);
    }
};
