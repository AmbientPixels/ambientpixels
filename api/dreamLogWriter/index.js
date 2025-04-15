// Example: api/generateNovaQuote/index.js
module.exports = async function (context, req) {
  context.log("generateNovaQuote called.");
  context.res = {
    status: 200,
    body: "Hello from generateNovaQuote!"
  };
};
