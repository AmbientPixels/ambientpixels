const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
  context.log('JavaScript HTTP trigger function processed a request for cardforgepublish');

  try {
    // Check if the request has a body
    if (!req.body || !req.body.cardId) {
      context.res = {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token'
        },
        body: { error: 'Card ID is required' }
      };
      return;
    }

    // Get user information from the request
    const userId = req.headers['x-user-id'] || 'anonymous';
    
    // Check if user is authenticated
    if (userId === 'anonymous') {
      context.res = {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token'
        },
        body: { error: 'Authentication required to publish cards' }
      };
      return;
    }

    // Get the card ID from the request body
    const { cardId } = req.body;

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

    // Path to user's cards file
    const userBlobPath = `user/${userId}/cards.json`;
    const blobClient = containerClient.getBlobClient(userBlobPath);
    
    // Check if the user's cards file exists
    if (!(await blobClient.exists())) {
      context.res = {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token'
        },
        body: { error: 'No cards found for this user' }
      };
      return;
    }
    
    // Download and parse the user's cards
    const downloadResponse = await blobClient.download();
    const content = await streamToText(downloadResponse.readableStreamBody);
    const userCards = JSON.parse(content);
    
    // Find the card to publish
    const cardToPublish = userCards.cards.find(c => c.id === cardId);
    
    if (!cardToPublish) {
      context.res = {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token'
        },
        body: { error: `Card with ID ${cardId} not found` }
      };
      return;
    }
    
    // Path to published cards file
    const publishedBlobPath = 'published-cards.json';
    const publishedBlobClient = containerClient.getBlobClient(publishedBlobPath);
    
    // Get or create the published cards file
    let publishedCards = { cards: [], metadata: { lastUpdated: new Date().toISOString() } };
    
    if (await publishedBlobClient.exists()) {
      // Download and parse the published cards
      const publishedDownloadResponse = await publishedBlobClient.download();
      const publishedContent = await streamToText(publishedDownloadResponse.readableStreamBody);
      publishedCards = JSON.parse(publishedContent);
    }
    
    // Check if the card is already published
    const existingPublishedIndex = publishedCards.cards.findIndex(c => c.id === cardId);
    
    // Prepare the card for publishing with additional metadata
    const publishedCard = {
      ...cardToPublish,
      publishedAt: new Date().toISOString(),
      publishedBy: userId,
      publishId: `pub-${Date.now()}`
    };
    
    if (existingPublishedIndex >= 0) {
      // Update existing published card
      publishedCards.cards[existingPublishedIndex] = publishedCard;
      context.log(`Updated existing published card with ID: ${cardId}`);
    } else {
      // Add new published card
      publishedCards.cards.push(publishedCard);
      context.log(`Published new card with ID: ${cardId}`);
    }
    
    // Update the lastUpdated timestamp
    publishedCards.metadata.lastUpdated = new Date().toISOString();
    
    // Upload the updated published cards file
    const publishedBlockBlobClient = containerClient.getBlockBlobClient(publishedBlobPath);
    const publishedData = JSON.stringify(publishedCards);
    await publishedBlockBlobClient.upload(publishedData, publishedData.length);
    
    // Update the user's card to mark it as published
    const userCardIndex = userCards.cards.findIndex(c => c.id === cardId);
    userCards.cards[userCardIndex] = {
      ...userCards.cards[userCardIndex],
      isPublished: true,
      publishedAt: publishedCard.publishedAt,
      publishId: publishedCard.publishId
    };
    
    // Upload the updated user cards file
    const userBlockBlobClient = containerClient.getBlockBlobClient(userBlobPath);
    const userData = JSON.stringify(userCards);
    await userBlockBlobClient.upload(userData, userData.length);
    
    // Return success response
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token'
      },
      body: {
        success: true,
        message: existingPublishedIndex >= 0 ? 'Card republished successfully' : 'Card published successfully',
        publishId: publishedCard.publishId
      }
    };
  } catch (error) {
    context.log.error(`Error in cardforgepublish: ${error.message}`);
    context.res = {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token'
      },
      body: { error: error.message }
    };
  }
};

/**
 * Convert a readable stream to text
 * @param {ReadableStream} readableStream - The stream to convert
 * @returns {Promise<string>} The stream content as text
 */
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
