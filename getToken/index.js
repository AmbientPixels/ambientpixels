const { v4: uuidv4 } = require('uuid');
module.exports = async function (context, req) {
    context.log('getToken called—method:', req.method, 'origin:', req.headers.origin);
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: {
                "Access-Control-Allow-Origin": "https://calm-sky-05cc8e110.6.azurestaticapps.net",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization"
            },
            body: ""
        };
    } else {
        context.res = {
            status: 200,
            headers: {
                "Access-Control-Allow-Origin": "https://calm-sky-05cc8e110.6.azurestaticapps.net",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization"
            },
            body: { token: uuidv4() }
        };
    }
};