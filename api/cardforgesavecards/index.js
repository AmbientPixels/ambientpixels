const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
  context.log('JavaScript HTTP trigger function processed a request for cardforgesavecards');

  try {
    // Check if the request has a body
    if (!req.body) {
      context.res = {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token'
        },
        body: { error: 'Request body is required' }
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
        body: { error: 'Authentication required to save cards' }
      };
      return;
    }

    // Get the card data from the request body
    const card = req.body;
    
    // Validate card data
    const validationErrors = validateCard(card);
    if (validationErrors.length > 0) {
      context.res = {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-ID, X-CSRF-Token'
        },
        body: { error: 'Invalid card data', validationErrors }
      };
      return;
    }

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
    let userCards = { cards: [], lastUpdated: new Date().toISOString() };
    const exists = await blobClient.exists();
    
    if (exists) {
      // Download and parse the user's cards
      const downloadResponse = await blobClient.download();
      const content = await streamToText(downloadResponse.readableStreamBody);
      userCards = JSON.parse(content);
    }
    
    // Check if the card already exists (update) or is new (add)
    const existingCardIndex = userCards.cards.findIndex(c => c.id === card.id);
    
    if (existingCardIndex >= 0) {
      // Update existing card
      userCards.cards[existingCardIndex] = {
        ...card,
        lastModified: new Date().toISOString()
      };
      context.log(`Updated existing card with ID: ${card.id}`);
    } else {
      // Add new card with metadata
      userCards.cards.push({
        ...card,
        id: card.id || `card-${Date.now()}`,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        userId: userId
      });
      context.log(`Added new card with ID: ${card.id || 'card-' + Date.now()}`);
    }
    
    // Update the lastUpdated timestamp
    userCards.lastUpdated = new Date().toISOString();
    
    // Upload the updated cards file
    const blockBlobClient = containerClient.getBlockBlobClient(userBlobPath);
    const data = JSON.stringify(userCards);
    await blockBlobClient.upload(data, data.length);
    
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
        message: existingCardIndex >= 0 ? 'Card updated successfully' : 'Card saved successfully',
        cardId: existingCardIndex >= 0 ? card.id : userCards.cards[userCards.cards.length - 1].id
      }
    };
  } catch (error) {
    context.log.error(`Error in cardforgesavecards: ${error.message}`);
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
 * Validate card data
 * @param {object} card - The card data to validate
 * @returns {Array} Array of validation errors, empty if valid
 */
function validateCard(card) {
  const errors = [];
  
  // Check required fields
  if (!card.name || card.name.trim().length < 2 || card.name.trim().length > 30) {
    errors.push('Name must be between 2 and 30 characters');
  }
  
  if (!card.class || card.class.trim().length < 2 || card.class.trim().length > 20) {
    errors.push('Class/Type must be between 2 and 20 characters');
  }
  
  if (!card.avatar || !isValidUrl(card.avatar)) {
    errors.push('Avatar/Image must be a valid URL');
  }
  
  // Check optional fields
  if (card.quote && card.quote.trim().length > 100) {
    errors.push('Quote/Description must be less than 100 characters');
  }
  
  if (card.achievement && card.achievement.trim().length > 50) {
    errors.push('Achievement must be less than 50 characters');
  }
  
  return errors;
}

/**
 * Check if a string is a valid URL
 * @param {string} url - The URL to validate
 * @returns {boolean} True if valid URL, false otherwise
 */
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
}

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
