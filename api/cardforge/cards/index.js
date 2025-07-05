module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request to cards.');

    const publicCards = context.bindings.inputBlob;

    if (publicCards) {
        context.res = {
            headers: { 'Content-Type': 'application/json' },
            body: publicCards
        };
    } else {
        // If the blob doesn't exist, return an empty array.
        context.res = {
            headers: { 'Content-Type': 'application/json' },
            body: []
        };
    }
};
