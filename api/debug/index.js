// CardForge API Debug Function
// Following Windsurf Dev Protocol - Check Before You Code
const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
    context.log('CardForge Debug API invoked - Testing Blob Storage Access');
    
    try {
        // Check for basic environment
        const environment = {
            nodeVersion: process.version,
            nodeEnv: process.env.NODE_ENV,
            hasStorageConnection: !!process.env.AZURE_STORAGE_CONNECTION_STRING,
            connectionStringStart: process.env.AZURE_STORAGE_CONNECTION_STRING 
                ? process.env.AZURE_STORAGE_CONNECTION_STRING.substring(0, 10) + '...' 
                : 'Not set',
            apiRoute: req.originalUrl || req.url || 'Unknown',
            headers: req.headers,
            functionDirectory: __dirname,
            functionName: context.executionContext?.functionName || 'Unknown'
        };
        
        // Initialize blob storage diagnostic results
        const blobDiagnostics = {};
        
        // Test blob storage connectivity
        try {
            context.log('Testing blob storage connectivity');
            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
            
            if (!connectionString) {
                blobDiagnostics.connectionTest = {
                    status: 'failed',
                    error: 'No connection string found'
                };
            } else {
                // Create blob service client
                const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
                blobDiagnostics.connectionTest = {
                    status: 'success',
                    clientCreated: true
                };
                
                // Test container access
                try {
                    context.log('Testing container access');
                    const containerName = 'cardforge';
                    const containerClient = blobServiceClient.getContainerClient(containerName);
                    
                    // Check if container exists
                    const containerExists = await containerClient.exists();
                    blobDiagnostics.containerTest = {
                        status: containerExists ? 'success' : 'failed',
                        exists: containerExists,
                        name: containerName
                    };
                    
                    // If container exists, try to list blobs
                    if (containerExists) {
                        context.log('Container exists, listing blobs');
                        const blobs = [];
                        let i = 0;
                        
                        try {
                            for await (const blob of containerClient.listBlobsFlat()) {
                                blobs.push({
                                    name: blob.name,
                                    contentLength: blob.properties.contentLength
                                });
                                if (++i >= 10) break; // Limit to 10 blobs
                            }
                            
                            blobDiagnostics.listBlobsTest = {
                                status: 'success',
                                count: blobs.length,
                                blobs: blobs
                            };
                        } catch (listError) {
                            blobDiagnostics.listBlobsTest = {
                                status: 'failed',
                                error: listError.message,
                                code: listError.code || 'Unknown'
                            };
                        }
                        
                        // Try to access published-cards.json specifically
                        try {
                            context.log('Testing published-cards.json access');
                            const blobName = 'published-cards.json';
                            const blobClient = containerClient.getBlockBlobClient(blobName);
                            
                            // Check if blob exists
                            const blobExists = await blobClient.exists();
                            
                            if (blobExists) {
                                // Try to download it
                                try {
                                    const downloadResponse = await blobClient.download(0);
                                    const content = await streamToString(downloadResponse.readableStreamBody);
                                    
                                    blobDiagnostics.publishedCardsTest = {
                                        status: 'success',
                                        exists: true,
                                        contentLength: downloadResponse.contentLength,
                                        isValidJson: isValidJson(content),
                                        content: content.substring(0, 100) + (content.length > 100 ? '...' : '')
                                    };
                                } catch (downloadError) {
                                    blobDiagnostics.publishedCardsTest = {
                                        status: 'failed',
                                        exists: true,
                                        error: downloadError.message,
                                        code: downloadError.code || 'Unknown'
                                    };
                                }
                            } else {
                                blobDiagnostics.publishedCardsTest = {
                                    status: 'failed',
                                    exists: false,
                                    error: 'Blob does not exist'
                                };
                            }
                        } catch (blobError) {
                            blobDiagnostics.publishedCardsTest = {
                                status: 'failed',
                                error: blobError.message,
                                code: blobError.code || 'Unknown'
                            };
                        }
                    }
                } catch (containerError) {
                    blobDiagnostics.containerTest = {
                        status: 'failed',
                        error: containerError.message,
                        code: containerError.code || 'Unknown'
                    };
                }
            }
        } catch (connectionError) {
            blobDiagnostics.connectionTest = {
                status: 'failed',
                error: connectionError.message,
                stack: connectionError.stack
            };
        }
        
        context.res = {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-ID, Authorization'
            },
            body: {
                message: 'CardForge API Blob Storage Debug Info',
                timestamp: new Date().toISOString(),
                environment: environment,
                blobDiagnostics: blobDiagnostics
            }
        };
    } catch (error) {
        context.res = {
            status: 500,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: { 
                message: 'Debug API Error',
                error: error.message,
                stack: error.stack
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

// Check if a string is valid JSON
function isValidJson(str) {
    try {
        JSON.parse(str);
        return true;
    } catch (e) {
        return false;
    }
}
