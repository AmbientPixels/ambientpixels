const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
    context.log('Processing request for public gallery cards');
    context.log('Request URL:', req.originalUrl || req.url);
    context.log('Request method:', req.method);
    
    // Add explicit CORS headers
    const responseHeaders = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-User-ID, Authorization'
    };
    
    // Handle OPTIONS request for CORS preflight
    if (req.method === 'OPTIONS') {
        context.log('Handling CORS preflight request');
        context.res = {
            status: 204,
            headers: responseHeaders,
            body: ''
        };
        return;
    }
    
    try {
        // Parse query parameters
        const category = req.query.category || 'all';
        const limit = parseInt(req.query.limit) || 20;
        const page = parseInt(req.query.page) || 1;
        const sortBy = req.query.sort || 'newest';
        
        context.log(`Request params: category=${category}, limit=${limit}, page=${page}, sortBy=${sortBy}`);
        
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
        
        // Fetch all published card metadata blobs
        const publishedCardsBlobName = 'published-cards.json';
        const publishedCardsClient = containerClient.getBlockBlobClient(publishedCardsBlobName);
        
        let publishedCards = [];
        try {
            // Check if the published cards metadata exists
            const exists = await publishedCardsClient.exists();
            
            if (exists) {
                // Download and parse the published cards metadata
                const downloadResponse = await publishedCardsClient.download(0);
                const publishedCardsData = await streamToString(downloadResponse.readableStreamBody);
                publishedCards = JSON.parse(publishedCardsData);
                context.log(`Found ${publishedCards.length} published cards`);
            } else {
                context.log('No published cards metadata found, creating empty list');
                // Initialize empty published cards metadata
                publishedCards = [];
                await publishedCardsClient.upload(
                    JSON.stringify(publishedCards),
                    JSON.stringify(publishedCards).length
                );
            }
            
            // Fetch user profiles for attribution
            const userProfilesBlobName = 'user-profiles.json';
            const userProfilesClient = containerClient.getBlockBlobClient(userProfilesBlobName);
            let userProfiles = {};
            
            // Check if user profiles exists
            const profilesExist = await userProfilesClient.exists();
            if (profilesExist) {
                const profilesResponse = await userProfilesClient.download(0);
                const profilesData = await streamToString(profilesResponse.readableStreamBody);
                userProfiles = JSON.parse(profilesData);
                context.log('Loaded user profiles for attribution');
            }
            
            // Enhance cards with creator attribution
            publishedCards = publishedCards.map(card => {
                // Add creator information
                const profile = userProfiles[card.userId] || {};
                return {
                    ...card,
                    creator: {
                        displayName: profile.displayName || 'Card Forge User',
                        username: profile.username || card.userId.substring(0, 8),
                        avatarUrl: profile.avatarUrl || '/images/default-avatar.png'
                    }
                };
            });
        } catch (error) {
            context.log.error('Error accessing published cards:', error);
            throw new Error('Failed to access published cards metadata');
        }
        
        // Apply category filter if needed
        let filteredCards = publishedCards;
        if (category && category !== 'all') {
            filteredCards = publishedCards.filter(card => 
                card.category === category || 
                (card.tags && card.tags.includes(category))
            );
        }
        
        // Apply sorting
        let sortedCards = [...filteredCards];
        switch (sortBy) {
            case 'newest':
                sortedCards.sort((a, b) => new Date(b.publishedDate) - new Date(a.publishedDate));
                break;
            case 'oldest':
                sortedCards.sort((a, b) => new Date(a.publishedDate) - new Date(b.publishedDate));
                break;
            case 'popular':
                sortedCards.sort((a, b) => (b.views || 0) - (a.views || 0));
                break;
            case 'staff-picks':
                // Staff picks first, then by newest
                sortedCards.sort((a, b) => {
                    if (a.staffPick && !b.staffPick) return -1;
                    if (!a.staffPick && b.staffPick) return 1;
                    return new Date(b.publishedDate) - new Date(a.publishedDate);
                });
                break;
        }
        
        // Apply pagination
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedCards = sortedCards.slice(startIndex, endIndex);
        
        // Prepare response metadata
        const response = {
            cards: paginatedCards,
            pagination: {
                total: sortedCards.length,
                page: page,
                limit: limit,
                pages: Math.ceil(sortedCards.length / limit)
            }
        };
        
        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: response
        };
    } catch (error) {
        context.log.error('Error in public gallery cards endpoint:', error);
        // Log the full error for server-side debugging
        context.log.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
        
        // Check connection string status for troubleshooting
        const connStringStatus = process.env.AZURE_STORAGE_CONNECTION_STRING 
            ? `Connection string exists (starts with: ${process.env.AZURE_STORAGE_CONNECTION_STRING.substring(0, 5)}...)` 
            : 'Connection string is missing';
            
        context.log.error('Connection string status:', connStringStatus);
        
        context.res = {
            status: 500,
            headers: responseHeaders,
            body: { 
                message: 'Error retrieving gallery cards', 
                error: error.message,
                connectionStatus: connStringStatus,
                timestamp: new Date().toISOString(),
                requestPath: req.originalUrl || req.url
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
