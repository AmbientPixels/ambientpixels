module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request for cardforgesavecards');
    
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

        // Get the cards array from the request body
        const cards = req.body;
        
        if (!cards || !Array.isArray(cards)) {
            context.res = {
                status: 400,
                body: { error: "Request body must be an array of cards" }
            };
            return;
        }

        // Write to blob storage via output binding
        context.bindings.outputBlob = JSON.stringify(cards, null, 2);
        
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: { 
                success: true,
                message: "Cards saved successfully",
                count: cards.length
            }
        };
    } catch (error) {
        context.log.error('Error in cardforgesavecards function: ', error);
        
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: { error: 'An error occurred while saving cards' }
        };
    }
};
