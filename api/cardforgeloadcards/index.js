const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
  context.log('JavaScript HTTP trigger function processed a request for cardforgeloadcards');

  try {
    // Get user information from the request
    const userId = req.headers['x-user-id'] || 'anonymous';
    const isAuthenticated = userId !== 'anonymous';

    // Get connection string from environment variable
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set.");
    }

    // Create blob service client
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerName = 'cardforge';
    
    // Try to get container client, create if it doesn't exist
    const containerClient = blobServiceClient.getContainerClient(containerName);
    try {
      await containerClient.createIfNotExists();
      context.log(`Container '${containerName}' created or already exists.`);
    } catch (error) {
      context.log.error(`Error creating container: ${error.message}`);
      throw new Error(`Failed to create container: ${error.message}`);
    }

    let cards = [];

    if (isAuthenticated) {
      // For authenticated users, load their personal cards
      const userBlobPath = `user/${userId}/cards.json`;
      const blobClient = containerClient.getBlobClient(userBlobPath);
      
      try {
        // Check if the user's cards blob exists
        const exists = await blobClient.exists();
        
        if (exists) {
          // Download and parse the user's cards
          const downloadResponse = await blobClient.download();
          const content = await streamToText(downloadResponse.readableStreamBody);
          cards = JSON.parse(content).cards || [];
          context.log(`Loaded ${cards.length} cards for user ${userId}`);
        } else {
          // If the user doesn't have cards yet, create an empty array
          context.log(`No cards found for user ${userId}, returning empty array`);
          cards = [];
          
          // Initialize the user's cards file with an empty array
          const initialData = JSON.stringify({ cards: [], lastUpdated: new Date().toISOString() });
          const blockBlobClient = containerClient.getBlockBlobClient(userBlobPath);
          await blockBlobClient.upload(initialData, initialData.length);
          context.log(`Initialized empty cards file for user ${userId}`);
        }
      } catch (error) {
        context.log.error(`Error loading user cards: ${error.message}`);
        throw new Error(`Failed to load user cards: ${error.message}`);
      }
    } else {
      // For anonymous users, load the public gallery cards
      const galleryBlobPath = 'published-cards.json';
      const blobClient = containerClient.getBlobClient(galleryBlobPath);
      
      try {
        // Check if the gallery blob exists
        const exists = await blobClient.exists();
        
        if (exists) {
          // Download and parse the gallery cards
          const downloadResponse = await blobClient.download();
          const content = await streamToText(downloadResponse.readableStreamBody);
          cards = JSON.parse(content).cards || [];
          context.log(`Loaded ${cards.length} cards from public gallery`);
        } else {
          // If the gallery doesn't exist yet, create a gallery with a sample card
          context.log('No public gallery found, initializing with sample card');
          
          // Create a sample card for the gallery
          const sampleCard = {
            id: `sample-${Date.now()}`,
            name: "Nova",
            class: "AI Assistant",
            avatar: "https://ambientpixels.ai/images/nova-avatar.png",
            quote: "Welcome to CardForge! Create your own cards and publish them to the gallery.",
            achievement: "First Card",
            createdAt: new Date().toISOString(),
            publishedAt: new Date().toISOString(),
            publishedBy: "system",
            publishId: `pub-sample-${Date.now()}`
          };
          
          cards = [sampleCard];
          
          // Initialize the gallery with the sample card
          const initialData = JSON.stringify({ 
            cards: [sampleCard], 
            metadata: { 
              lastUpdated: new Date().toISOString(),
              description: "CardForge public gallery"
            }
          });
          const blockBlobClient = containerClient.getBlockBlobClient(galleryBlobPath);
          await blockBlobClient.upload(initialData, initialData.length);
          context.log('Initialized empty public gallery');
        }
      } catch (error) {
        context.log.error(`Error loading gallery cards: ${error.message}`);
        throw new Error(`Failed to load gallery cards: ${error.message}`);
      }
    }

    // Return the cards with appropriate headers
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID'
      },
      body: cards
    };
  } catch (error) {
    context.log.error(`Error in cardforgeloadcards: ${error.message}`);
    context.res = {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID'
      },
      body: { error: error.message }
    };
  }
};

// Helper function to convert stream to text
async function streamToText(readableStream) {
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
