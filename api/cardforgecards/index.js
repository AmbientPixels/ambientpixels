module.exports = async function (context, req, cardBlob) {
    context.log('JavaScript HTTP trigger function processed a request for cardforgecards');

    try {
        // If cardBlob is available, return it
        if (cardBlob) {
            // Parse the JSON if it's a string
            const cards = typeof cardBlob === 'string' ? JSON.parse(cardBlob) : cardBlob;

            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: cards
            };
        } else {
            // If no cards found, return empty array
            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: []
            };
        }
    } catch (error) {
        context.log.error('Error in cardforgecards function: ', error);
        
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: { error: 'An error occurred while retrieving cards' }
        };
    }
};
