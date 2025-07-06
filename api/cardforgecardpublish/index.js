module.exports = async function (context, req, galleryBlob) {
    context.log('JavaScript HTTP trigger function processed a request for cardforgecardpublish');
    
    try {
        // Get the card to publish from the request body
        const cardToPublish = req.body;
        
        if (!cardToPublish || typeof cardToPublish !== 'object' || !cardToPublish.id) {
            context.res = {
                status: 400,
                body: { error: "Request body must contain a valid card object with an id" }
            };
            return;
        }

        // Add timestamp to the card
        cardToPublish.publishedAt = new Date().toISOString();
        
        // Process existing gallery data
        let galleryCards = [];
        
        // If galleryBlob exists, parse it
        if (galleryBlob) {
            galleryCards = typeof galleryBlob === 'string' ? JSON.parse(galleryBlob) : galleryBlob;
            
            // Ensure galleryCards is an array
            if (!Array.isArray(galleryCards)) {
                galleryCards = [];
            }
        }
        
        // Check if card with this ID already exists
        const existingCardIndex = galleryCards.findIndex(card => card.id === cardToPublish.id);
        
        if (existingCardIndex >= 0) {
            // Update existing card
            galleryCards[existingCardIndex] = cardToPublish;
        } else {
            // Add new card
            galleryCards.push(cardToPublish);
        }
        
        // Write updated gallery back to blob storage
        context.bindings.outputGalleryBlob = JSON.stringify(galleryCards, null, 2);
        
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: { 
                success: true,
                message: "Card published to gallery successfully",
                cardId: cardToPublish.id
            }
        };
    } catch (error) {
        context.log.error('Error in cardforgecardpublish function: ', error);
        
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: { error: 'An error occurred while publishing card to gallery' }
        };
    }
};
