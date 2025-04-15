module.exports = async function (context, req) {
  context.log("Function triggered:", context.executionContext.functionName);

  context.res = {
    status: 200,
    body: "✅ Hello from " + context.executionContext.functionName
  };
};
