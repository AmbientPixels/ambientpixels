const { BlobServiceClient } = require('@azure/storage-blob');
const fetch = require('node-fetch');

/**
 * CardForge Load Cards API
 * Loads cards based on user authentication status
 * For authenticated users: Returns their personal cards + gallery cards
 * For anonymous users: Returns default cards + gallery cards
 */

// Helper function to get blob URLs
function getBlobUrl(accountName, containerName, blobName) {
  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}`;
}

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

// Helper function to safely fetch JSON from a URL with retries
async function fetchJsonWithRetry(url, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
    }
  }
  throw lastError;
}

module.exports = async function (context, req) {
  context.log('JavaScript HTTP trigger function processed a request for cardforgeloadcards');

  try {
    // Get user information from the request
    const userId = req.headers['x-user-id'] || 'anonymous';
    const isAuthenticated = userId !== 'anonymous';
    context.log(`User ID: ${userId}, Authenticated: ${isAuthenticated}`);

    // Get connection string from environment variable
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) {
      context.log.error("AZURE_STORAGE_CONNECTION_STRING is not set.");
      throw new Error("Storage connection string is not configured. Please contact the administrator.");
    }
    
    // Extract account name from connection string
    const accountNameMatch = connectionString.match(/AccountName=([^;]+)/i);
    const accountName = accountNameMatch ? accountNameMatch[1] : 'cardforgeblobdata';
    context.log(`Using storage account: ${accountName}`);
    
    // Define container name and blob URLs
    const containerName = 'cardforge';
    const DEFAULT_CARDS_URL = getBlobUrl(accountName, containerName, 'default-cards.json');
    const PUBLISHED_CARDS_URL = getBlobUrl(accountName, containerName, 'published-cards.json');
    
    context.log(`Default cards URL: ${DEFAULT_CARDS_URL}`);
    context.log(`Published cards URL: ${PUBLISHED_CARDS_URL}`);

    // Create blob service client
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    
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
      const galleryData = await fetchJsonWithRetry(PUBLISHED_CARDS_URL);
      galleryCards = galleryData.publishedCards || [];
      context.log(`Loaded ${galleryCards.length} cards from public gallery`);
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
          const userData = JSON.parse(content);
          userCards = userData.cards || [];
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
        const defaultData = await fetchJsonWithRetry(DEFAULT_CARDS_URL);
        userCards = defaultData.defaultCards || [];
        context.log(`Loaded ${userCards.length} default cards for anonymous user`);
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
