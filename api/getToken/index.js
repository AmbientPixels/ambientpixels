module.exports = async function (context, req) {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.API_KEY;
  const token = process.env.ACCESS_TOKEN;

  if (!apiKey || apiKey !== expectedKey) {
    context.res = { status: 403, body: "Forbidden: Invalid API key" };
    return;
  }
  if (!token) {
    context.res = { status: 500, body: "Server error: No token configured" };
    return;
  }
  context.res = { status: 200, body: { token: token } };
};