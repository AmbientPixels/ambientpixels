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
            context.log('DEBUG: About to check if published cards metadata exists');
            // Check if the published cards metadata exists
            const exists = await publishedCardsClient.exists();
            context.log('DEBUG: publishedCardsClient.exists() result:', exists);
            
            if (exists) {
                context.log('DEBUG: Published cards exists, attempting to download');
                // Download and parse the published cards metadata
                const downloadResponse = await publishedCardsClient.download(0);
                context.log('DEBUG: Download response received:', downloadResponse.contentLength, 'bytes');
                const publishedCardsData = await streamToString(downloadResponse.readableStreamBody);
                context.log('DEBUG: Stream converted to string, length:', publishedCardsData.length);
                const publishedCardsObj = JSON.parse(publishedCardsData);
                // Extract the cards array from the object structure
                publishedCards = publishedCardsObj.cards || [];
                context.log(`Found ${publishedCards.length} published cards`);
                context.log('DEBUG: Published cards data structure:', JSON.stringify(publishedCardsObj).substring(0, 100) + '...');
            } else {
                context.log('No published cards metadata found, creating empty list');
                // Initialize empty published cards metadata
                publishedCards = [];
                context.log('DEBUG: About to upload empty published cards array');
                await publishedCardsClient.upload(
                    JSON.stringify({ cards: [] }),
                    JSON.stringify({ cards: [] }).length
                );
                context.log('DEBUG: Empty published cards array uploaded successfully');
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
            }
            
            // Apply filters
            let filteredCards = [...publishedCards];
            
            // Apply category filter
            if (category && category !== 'all') {
                filteredCards = filteredCards.filter(card => card.category === category);
            }
            
            // Apply sorting
            filteredCards.sort((a, b) => {
                if (sortBy === 'newest') {
                    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
                } else if (sortBy === 'oldest') {
                    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
                } else if (sortBy === 'popular') {
                    return (b.likes || 0) - (a.likes || 0);
                }
                return 0;
            });
            
            // Apply pagination
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + limit;
            const paginatedCards = filteredCards.slice(startIndex, endIndex);
            
            // Enrich cards with user info
            const enrichedCards = paginatedCards.map(card => {
                const userId = card.userId;
                const userProfile = userProfiles[userId] || { displayName: 'Unknown User' };
                
                return {
                    ...card,
                    author: userProfile.displayName,
                    authorAvatar: userProfile.photoURL || null
                };
            });
            
            // Send response
            context.res = {
                status: 200,
                headers: responseHeaders,
                body: {
                    cards: enrichedCards,
                    pagination: {
                        total: filteredCards.length,
                        page,
                        limit,
                        pages: Math.ceil(filteredCards.length / limit)
                    }
                }
            };
        } catch (error) {
            context.log.error('Error processing gallery cards:', error);
            context.res = {
                status: 500,
                headers: responseHeaders,
                body: {
                    success: false,
                    message: 'Error processing gallery cards'
                }
            };
        }
    } catch (error) {
        context.log.error('Unhandled exception:', error);
        context.res = {
            status: 500,
            headers: responseHeaders,
            body: {
                success: false,
                message: 'Internal server error'
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
