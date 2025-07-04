const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
    context.log('cardforge/cardpublish function processed a request');
    context.log('Card ID from route parameters:', req.params.id);
    context.log('Request Headers:', JSON.stringify(req.headers));

    // Add CORS headers to allow cross-origin requests
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Headers": "Content-Type, X-User-ID, x-user-id"
    };

    // Get card ID from route parameter
    const cardId = req.params.id;
    if (!cardId) {
        context.log.error('Card ID not provided in route parameter');
        context.res = {
            status: 400,
            headers,
            body: JSON.stringify({ error: "Card ID not provided in URL. Use /api/cardforge/cardpublish/{id}" })
        };
        return;
    }

    // Get user ID from headers or query parameters
    let userId = null;
    
    // Check headers in a case-insensitive way
    const userIdHeaderKey = Object.keys(req.headers).find(key => key.toLowerCase() === 'x-user-id');
    if (userIdHeaderKey) {
        userId = req.headers[userIdHeaderKey];
        context.log(`Found userId in header with key ${userIdHeaderKey}: ${userId}`);
    }
    
    if (!userId) {
        context.log.error('User ID not provided');
        context.res = {
            status: 401,
            headers,
            body: JSON.stringify({ error: "User ID not provided. Please include X-User-ID header." })
        };
        return;
    }

    try {
        // Connect to Azure Blob Storage
        const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
        if (!connectionString) {
            throw new Error('Azure Storage connection string not found');
        }
        
        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerClient = blobServiceClient.getContainerClient('cardforge');
        
        // Create container if it doesn't exist
        await containerClient.createIfNotExists();
        
        // Get user's cards blob
        const userBlobName = `${userId}.json`;
        const userBlobClient = containerClient.getBlockBlobClient(userBlobName);
        const userBlobExists = await userBlobClient.exists();
        
        if (!userBlobExists) {
            context.log.error(`User blob not found for userId: ${userId}`);
            context.res = {
                status: 404,
                headers,
                body: JSON.stringify({ error: "User data not found. Please create a card first." })
            };
            return;
        }
        
        // Download user's cards
        const downloadResponse = await userBlobClient.download(0);
        const cardsString = await streamToString(downloadResponse.readableStreamBody);
        
        // Parse cards string to JSON
        let cardsData;
        let targetCard = null;
        
        try {
            cardsData = JSON.parse(cardsString);
            
            // Find the card by ID
            if (Array.isArray(cardsData)) {
                targetCard = cardsData.find(card => card && card.id === cardId);
            }
            
            if (!targetCard) {
                context.log.error(`Card with ID ${cardId} not found in user's data`);
                context.res = {
                    status: 404,
                    headers,
                    body: JSON.stringify({ error: `Card with ID ${cardId} not found` })
                };
                return;
            }
            
            // Mark card as published
            targetCard.isPublished = true;
            
            // Save updated cards data back to blob
            const updatedCardsString = JSON.stringify(cardsData);
            await userBlobClient.upload(updatedCardsString, updatedCardsString.length);
            
            // Also save to published cards collection (if applicable)
            // For simplicity in this version, we're not implementing a separate published cards collection
            
            context.log(`Card ${cardId} published successfully`);
            context.res = {
                status: 200,
                headers,
                body: JSON.stringify({ 
                    success: true, 
                    message: "Card published successfully",
                    card: targetCard
                })
            };
        } catch (parseError) {
            context.log.error(`Error parsing user's cards data: ${parseError.message}`);
            context.res = {
                status: 500,
                headers,
                body: JSON.stringify({ error: "Invalid cards data format" })
            };
        }
    } catch (error) {
        context.log.error(`Error publishing card: ${error.message}`);
        context.res = {
            status: 500,
            headers,
            body: JSON.stringify({ error: `Failed to publish card: ${error.message}` })
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
