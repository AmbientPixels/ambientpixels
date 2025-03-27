const { v4: uuidv4 } = require('uuid');
module.exports = async function (context, req) {
    const token = uuidv4();
    context.res = { status: 200, body: { token: token } };
};