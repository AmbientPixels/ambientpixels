module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request for debug info.');

    const header = req.headers['x-ms-client-principal'];
    if (!header) {
        context.res = {
            status: 401,
            body: "User is not authenticated."
        };
        return;
    }
    const encoded = Buffer.from(header, 'base64');
    const decoded = encoded.toString('ascii');

    context.res = {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.parse(decoded)
    };
};
