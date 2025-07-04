const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
    context.log('cardforge/savecards function processed a request');

    // Add CORS headers to allow cross-origin requests
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Headers": "Content-Type, X-User-ID, x-user-id"
    };

    // Get user ID from headers or query parameters
    let userId = null;
    
    // Check headers in a case-insensitive way
    const userIdHeaderKey = Object.keys(req.headers).find(key => key.toLowerCase() === 'x-user-id');
    if (userIdHeaderKey) {
        userId = req.headers[userIdHeaderKey];
        context.log(`Found userId in header with key ${userIdHeaderKey}: ${userId}`);
    }
    
    // If not found in headers, check query params
    if (!userId) {
        userId = req.query.userId;
        if (userId) {
            context.log(`Found userId in query parameter: ${userId}`);
        }
    }
    
    if (!userId) {
        context.log.error('User ID not provided');
        context.res = {
            status: 401,
            headers,
            body: JSON.stringify({ error: "User ID not provided. Please include X-User-ID header or userId query parameter." })
        };
        return;
    }

    // Check if cards data was provided in the request body
    if (!req.body) {
        context.log.error('Request body is empty');
        context.res = {
            status: 400,
            headers,
            body: JSON.stringify({ error: "Request body is empty. Please provide cards data." })
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
        
        // Save user's cards data
        const userBlobName = `${userId}.json`;
        const userBlobClient = containerClient.getBlockBlobClient(userBlobName);
        
        // Convert cards array to JSON string if it's not already
        const cardsData = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        
        // Upload to blob storage
        await userBlobClient.upload(cardsData, cardsData.length);
        
        context.log(`Cards saved successfully for user ${userId}`);
        context.res = {
            status: 200,
            headers,
            body: JSON.stringify({ success: true, message: "Cards saved successfully" })
        };
    } catch (error) {
        context.log.error(`Error saving cards: ${error.message}`);
        context.res = {
            status: 500,
            headers,
            body: JSON.stringify({ error: `Failed to save cards: ${error.message}` })
        };
    }
};
