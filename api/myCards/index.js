const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
    context.log('Processing request for personal card library');

    // Validate authentication
    const userId = req.headers['x-user-id'] || req.query.userId || (req.body && req.body.userId);
    
    if (!userId) {
        context.res = {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
            body: { message: 'User not authenticated. Please sign in to access your personal card library.' }
        };
        return;
    }
    
    try {
        // Parse query parameters
        const filter = req.query.filter || 'all';
        const sort = req.query.sort || 'newest';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        context.log(`Request params: userId=${userId}, filter=${filter}, sort=${sort}, page=${page}, limit=${limit}`);

        // Initialize Azure Blob Storage client
        const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
        if (!connectionString) {
            throw new Error('Azure Storage connection string not found');
        }
        
        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerName = 'cardforge';
        const containerClient = blobServiceClient.getContainerClient(containerName);
        
        // Create container if it doesn't exist
        try {
            await containerClient.createIfNotExists();
            context.log('Container created or already exists');
        } catch (containerError) {
            context.log.error('Error creating container:', containerError);
            throw new Error('Failed to ensure container exists');
        }
        
        // Check if the user's card data exists
        const userBlobName = `${userId}.json`;
        const blockBlobClient = containerClient.getBlockBlobClient(userBlobName);
        const blobExists = await blockBlobClient.exists();
        
        let userCards = [];
        
        if (blobExists) {
            // Download the blob content
            const downloadResponse = await blockBlobClient.download(0);
            const downloadedContent = await streamToString(downloadResponse.readableStreamBody);
            
            // Parse JSON content
            userCards = JSON.parse(downloadedContent);
            context.log(`Found ${userCards.length} cards for user ${userId}`);
        } else {
            context.log(`No cards found for user ${userId}`);
        }
        
        // Get published cards metadata to check publishing status
        let publishedCards = [];
        try {
            const publishedCardsBlobName = 'published-cards.json';
            const publishedCardsClient = containerClient.getBlockBlobClient(publishedCardsBlobName);
            const publishedExists = await publishedCardsClient.exists();
            
            if (publishedExists) {
                const downloadResponse = await publishedCardsClient.download(0);
                const publishedData = await streamToString(downloadResponse.readableStreamBody);
                publishedCards = JSON.parse(publishedData);
            }
        } catch (error) {
            context.log.warn('Error accessing published cards:', error);
            // Continue without published data if there's an error
        }
        
        // Mark cards that are published
        userCards = userCards.map(card => {
            const isPublished = publishedCards.some(pubCard => 
                pubCard.id === card.id && pubCard.userId === userId
            );
            return { ...card, isPublished };
        });
        
        // Apply filter if needed
        let filteredCards = userCards;
        if (filter === 'published') {
            filteredCards = userCards.filter(card => card.isPublished);
        } else if (filter === 'drafts') {
            filteredCards = userCards.filter(card => !card.isPublished);
        }
        
        // Apply sorting
        switch (sort) {
            case 'newest':
                filteredCards.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
                break;
            case 'oldest':
                filteredCards.sort((a, b) => new Date(a.lastModified) - new Date(b.lastModified));
                break;
            case 'az':
                filteredCards.sort((a, b) => {
                    const nameA = a.name ? a.name.toLowerCase() : '';
                    const nameB = b.name ? b.name.toLowerCase() : '';
                    return nameA.localeCompare(nameB);
                });
                break;
        }
        
        // Apply pagination
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedCards = filteredCards.slice(startIndex, endIndex);
        
        // Prepare response
        const response = {
            cards: paginatedCards,
            pagination: {
                total: filteredCards.length,
                page: page,
                limit: limit,
                pages: Math.ceil(filteredCards.length / limit)
            }
        };
        
        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: response
        };
        
    } catch (error) {
        context.log.error('Error in personal card library endpoint:', error);
        context.res = {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: { 
                message: 'Error retrieving personal card library', 
                error: error.message 
            }
        };
    }
};

// Helper function to convert stream to string
async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', (data) => {
            chunks.push(data.toString());
        });
        readableStream.on('end', () => {
            resolve(chunks.join(''));
        });
        readableStream.on('error', reject);
    });
}
