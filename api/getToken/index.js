module.exports = async function (context, req) {
  const token = process.env.ACCESS_TOKEN;
  context.res = { body: { token } };
};