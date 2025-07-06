module.exports = async function (context, req, userCardsBlob) {
    context.log('JavaScript HTTP trigger function processed a request for cardforgemycards');
    
    try {
        // Extract userId from route parameters
        const userId = context.bindingData.userId;
        
        if (!userId) {
            context.res = {
                status: 400,
                body: { error: "User ID is required" }
            };
            return;
        }

        // If userCardsBlob is available, return it
        if (userCardsBlob) {
            // Parse the JSON if it's a string
            const userCards = typeof userCardsBlob === 'string' ? JSON.parse(userCardsBlob) : userCardsBlob;
            
            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: userCards
            };
        } else {
            // If no cards found for this user, return empty array
            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: []
            };
        }
    } catch (error) {
        context.log.error('Error in cardforgemycards function: ', error);
        
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: { error: 'An error occurred while retrieving user cards' }
        };
    }
};
