const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
    context.log('cardforge/loadcards function processed a request');

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
        
        // Check if user's data exists
        const userBlobName = `${userId}.json`;
        const userBlobClient = containerClient.getBlockBlobClient(userBlobName);
        const userBlobExists = await userBlobClient.exists();
        
        if (!userBlobExists) {
            // Return empty array if user has no cards yet
            context.log(`No cards found for user ${userId}`);
            context.res = {
                status: 200,
                headers,
                body: JSON.stringify([])
            };
            return;
        }
        
        // Download and return user's cards
        const downloadResponse = await userBlobClient.download(0);
        const cards = await streamToString(downloadResponse.readableStreamBody);
        
        context.res = {
            status: 200,
            headers,
            body: cards // Already JSON string
        };
    } catch (error) {
        context.log.error(`Error loading cards: ${error.message}`);
        context.res = {
            status: 500,
            headers,
            body: JSON.stringify({ error: `Failed to load cards: ${error.message}` })
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
