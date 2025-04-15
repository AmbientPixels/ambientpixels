module.exports = async function (context, req) {
  context.res = {
    status: 200,
    body: { env: process.env.NODE_ENV || 'production' }
  };
};