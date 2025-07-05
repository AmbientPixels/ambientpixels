module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request to loadcards.');

    const principal = req.headers['x-ms-client-principal'];
    if (!principal) {
        context.res = {
            status: 401,
            body: "User is not authenticated."
        };
        return;
    }

    const userCards = context.bindings.inputBlob;

    if (userCards) {
        context.res = {
            headers: { 'Content-Type': 'application/json' },
            body: userCards
        };
    } else {
        // If the blob doesn't exist, it means the user hasn't saved any cards yet.
        // Return an empty array.
        context.res = {
            headers: { 'Content-Type': 'application/json' },
            body: []
        };
    }
};

