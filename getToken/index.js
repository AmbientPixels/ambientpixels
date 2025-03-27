const { v4: uuidv4 } = require('uuid');
module.exports = async function (context, req) {
    context.log('getToken called—origin:', req.headers.origin); // Debug
    context.res = {
        status: 200,
        headers: {
            "Access-Control-Allow-Origin": "https://calm-sky-05cc8e110.6.azurestaticapps.net",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization"
        },
        body: { token: uuidv4() }
    };
};