const { BlobServiceClient } = require('@azure/storage-blob');
const fetch = require('node-fetch');

// URLs for default and published cards
const DEFAULT_CARDS_URL = 'https://cardforgeblobdata.blob.core.windows.net/cardforge/default-cards.json';
const PUBLISHED_CARDS_URL = 'https://cardforgeblobdata.blob.core.windows.net/cardforge/published-cards.json';

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

    let userCards = [];
    let galleryCards = [];

    // Load gallery cards from the published cards URL
    try {
      context.log(`Fetching published cards from ${PUBLISHED_CARDS_URL}`);
      const response = await fetch(PUBLISHED_CARDS_URL);
      
      if (response.ok) {
        const data = await response.json();
        galleryCards = data.publishedCards || [];
        context.log(`Loaded ${galleryCards.length} cards from public gallery`);
      } else {
        context.log.error(`Failed to fetch published cards: HTTP ${response.status}`);
        galleryCards = [];
      }
    } catch (error) {
      context.log.error(`Error loading published cards: ${error.message}`);
      galleryCards = [];
    }

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
          userCards = JSON.parse(content).cards || [];
          context.log(`Loaded ${userCards.length} cards for user ${userId}`);
        } else {
          // If the user doesn't have cards yet, create an empty array
          context.log(`No cards found for user ${userId}, returning empty array`);
          userCards = [];
          
          // Initialize the user's cards file with an empty array
          const initialData = JSON.stringify({ cards: [], lastUpdated: new Date().toISOString() });
          const blockBlobClient = containerClient.getBlockBlobClient(userBlobPath);
          await blockBlobClient.upload(initialData, initialData.length);
          context.log(`Initialized empty cards file for user ${userId}`);
        }
      } catch (error) {
        context.log.error(`Error loading user cards: ${error.message}`);
        userCards = [];
      }
    } else {
      // For anonymous users, load default cards
      try {
        context.log(`Fetching default cards from ${DEFAULT_CARDS_URL}`);
        const response = await fetch(DEFAULT_CARDS_URL);
        
        if (response.ok) {
          const data = await response.json();
          userCards = data.defaultCards || [];
          context.log(`Loaded ${userCards.length} default cards for anonymous user`);
        } else {
          context.log.error(`Failed to fetch default cards: HTTP ${response.status}`);
          userCards = [];
        }
      } catch (error) {
        context.log.error(`Error loading default cards: ${error.message}`);
        userCards = [];
      }
    }
    
    // Return both user cards and gallery cards
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID'
      },
      body: {
        userCards,
        galleryCards
      }
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
      body: {
        error: `Failed to load cards: ${error.message}`
      }
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
