const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
    // Enhanced logging with timestamp for better debugging
    const requestTimestamp = new Date().toISOString();
    context.log(`[${requestTimestamp}] CardForge Publish API Request`);
    context.log(`Route: /api/cardforge/cardpublish/${req.params.id || 'undefined'}`);
    context.log(`Method: ${req.method}`);
    context.log(`Headers: ${JSON.stringify(req.headers, null, 2)}`);
    context.log(`Body: ${JSON.stringify(req.body, null, 2)}`);

    // Standard CORS headers for cross-origin requests
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-User-ID, x-user-id, Authorization',
        'Access-Control-Max-Age': '86400' // 24 hours
    };

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        context.log('Handling OPTIONS preflight request');
        context.res = {
            status: 204, // No content for OPTIONS
            headers
        };
        return;
    }

    // Extract card ID from route parameter
    const cardId = req.params.id;
    if (!cardId) {
        context.log.error('Card ID missing in request URL');
        context.res = {
            status: 400,
            headers,
            body: JSON.stringify({
                status: 'error',
                code: 'MISSING_CARD_ID',
                message: 'Card ID not provided in URL. Use /api/cardforge/cardpublish/{id}'
            })
        };
        return;
    }

    // Extract and validate user ID from headers (case-insensitive)
    let userId = null;
    const userIdHeaderKey = Object.keys(req.headers).find(key => key.toLowerCase() === 'x-user-id');
    
    if (userIdHeaderKey) {
        userId = req.headers[userIdHeaderKey];
        context.log(`Found userId in header '${userIdHeaderKey}': ${userId}`);
    } else {
        // Alternative: check body
        if (req.body && req.body.userId) {
            userId = req.body.userId;
            context.log(`Found userId in request body: ${userId}`);
        }
    }

    // Return 401 if no valid user ID
    if (!userId) {
        context.log.error('Authentication failed: No user ID provided');
        context.res = {
            status: 401,
            headers,
            body: JSON.stringify({
                status: 'error',
                code: 'AUTHENTICATION_REQUIRED',
                message: 'Authentication required. Please include X-User-ID header or userId in request body.'
            })
        };
        return;
    }

    try {
        // Get the card data from request body if available
        let submittedCardData = null;
        if (req.body && req.body.card) {
            submittedCardData = req.body.card;
            context.log(`Card data submitted in request body for card ID: ${cardId}`);
        }

        // Access Azure Blob Storage
        const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
        if (!connectionString) {
            throw new Error('Storage configuration missing: AZURE_STORAGE_CONNECTION_STRING not found');
        }
        
        // Initialize blob service and container clients
        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerName = 'cardforge';
        const containerClient = blobServiceClient.getContainerClient(containerName);
        
        // Create the container if it doesn't exist yet
        context.log(`Ensuring container '${containerName}' exists...`);
        await containerClient.createIfNotExists({
            access: 'container' // Public read access for container
        });
        
        // Get user's personal cards collection
        const userBlobName = `user-${userId}.json`;
        const userBlobClient = containerClient.getBlockBlobClient(userBlobName);
        
        if (!(await userBlobClient.exists())) {
            context.log.error(`User data not found for user ID: ${userId}`);
            context.res = {
                status: 404,
                headers,
                body: JSON.stringify({
                    status: 'error',
                    code: 'USER_DATA_NOT_FOUND',
                    message: 'User data not found. Please save cards to your account first.'
                })
            };
            return;
        }
        
        // Get the user's cards data
        context.log(`Retrieving card data for user ${userId}`);
        const downloadResponse = await userBlobClient.download(0);
        const cardsString = await streamToString(downloadResponse.readableStreamBody);
        
        // Parse the user's cards JSON
        let cardsData;
        let targetCard = null;
        
        try {
            cardsData = JSON.parse(cardsString);
            
            if (!Array.isArray(cardsData)) {
                context.log.error('User data is not a valid array');
                throw new Error('Invalid user data format: expected array');
            }
            
            // Find the card to publish by ID
            targetCard = cardsData.find(card => card && card.id === cardId);
            
            if (!targetCard) {
                context.log.error(`Card ID ${cardId} not found in user's data`);
                context.res = {
                    status: 404,
                    headers,
                    body: JSON.stringify({
                        status: 'error',
                        code: 'CARD_NOT_FOUND',
                        message: `Card with ID ${cardId} not found in your collection`
                    })
                };
                return;
            }
            
            // Update with submitted card data if available
            if (submittedCardData) {
                // Preserve the original ID and user ID
                const originalId = targetCard.id;
                const originalUserId = targetCard.userId;
                
                // Merge submitted data with stored card data
                Object.assign(targetCard, submittedCardData);
                
                // Ensure ID and user ID haven't been changed
                targetCard.id = originalId;
                targetCard.userId = originalUserId;
                
                context.log(`Updated card data from submission for card ID: ${cardId}`);
            }
            
            // Mark the card as published
            targetCard.isPublished = true;
            targetCard.publishedAt = new Date().toISOString();
            
            // Save the updated cards collection back to the user's storage
            context.log(`Saving updated cards data for user ${userId}`);
            const updatedCardsString = JSON.stringify(cardsData, null, 2);
            await userBlobClient.upload(updatedCardsString, updatedCardsString.length);
            
            // Also save to the public gallery
            const publicGalleryBlobName = 'public-gallery.json';
            const publicGalleryClient = containerClient.getBlockBlobClient(publicGalleryBlobName);
            
            let galleryCards = [];
            
            // Try to load existing gallery
            if (await publicGalleryClient.exists()) {
                const galleryData = await publicGalleryClient.download(0);
                const galleryString = await streamToString(galleryData.readableStreamBody);
                
                try {
                    galleryCards = JSON.parse(galleryString);
                    if (!Array.isArray(galleryCards)) {
                        galleryCards = [];
                    }
                } catch (e) {
                    context.log.error(`Error parsing gallery data: ${e.message}`);
                    galleryCards = [];
                }
            }
            
            // Create a public copy of the card (remove any private fields)
            const publicCard = { 
                ...targetCard,
                userId: userId,  // Preserve user ID for attribution
                private: false,
                isPublished: true
            };
            
            // Remove any sensitive fields
            delete publicCard.privateNotes;
            delete publicCard.email;
            delete publicCard.personalInfo;
            
            // Add or update the card in the gallery
            const existingIndex = galleryCards.findIndex(card => card.id === cardId);
            if (existingIndex >= 0) {
                galleryCards[existingIndex] = publicCard;
            } else {
                galleryCards.push(publicCard);
            }
            
            // Sort by most recent first
            galleryCards.sort((a, b) => {
                const dateA = a.publishedAt || a.lastModified || '';
                const dateB = b.publishedAt || b.lastModified || '';
                return dateB.localeCompare(dateA);
            });
            
            // Save the updated gallery
            context.log(`Saving card to public gallery`);
            const galleryString = JSON.stringify(galleryCards, null, 2);
            await publicGalleryClient.upload(galleryString, galleryString.length);
            
            // Return success response with the published card
            context.log(`Card ${cardId} published successfully`);
            context.res = {
                status: 200,
                headers,
                body: JSON.stringify({
                    status: 'success',
                    message: 'Card published successfully',
                    cardId: cardId,
                    publishedAt: publicCard.publishedAt,
                    card: publicCard
                })
            };
        } catch (parseError) {
            context.log.error(`Error processing card data: ${parseError.message}`);
            context.log.error(parseError.stack);
            context.res = {
                status: 500,
                headers,
                body: JSON.stringify({
                    status: 'error',
                    code: 'DATA_PROCESSING_ERROR',
                    message: `Error processing card data: ${parseError.message}`
                })
            };
        }
    } catch (error) {
        context.log.error(`Unhandled error in cardpublish function: ${error.message}`);
        context.log.error(error.stack);
        context.res = {
            status: 500,
            headers,
            body: JSON.stringify({
                status: 'error',
                code: 'SERVER_ERROR',
                message: `An unexpected error occurred: ${error.message}`
            })
        };
    }
};

/**
 * Helper function to convert a stream to a string
 * @param {ReadableStream} readableStream - The stream to convert
 * @returns {Promise<string>} Promise resolving to the stream contents as string
 */
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
