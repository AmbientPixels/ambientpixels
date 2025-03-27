const { v4: uuidv4 } = require('uuid');

module.exports = async function (context, req) {
    const token = uuidv4(); // Generates random token, e.g., '550e8400-e29b-41d4-a716-446655440000'
    context.res = {
        status: 200,
        body: { token: token }
    };
};