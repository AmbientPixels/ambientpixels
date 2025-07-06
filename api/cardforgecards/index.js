module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request for cardforgecards');

    try {
        // For testing deployment, return a simple response
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: {
                message: "CardForge API is working",
                endpoint: "cardforgecards",
                status: "success",
                timestamp: new Date().toISOString()
            }
        };
    } catch (error) {
        context.log.error('Error in cardforgecards function: ', error);
        
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: { error: 'An error occurred while processing request' }
        };
    }
};
