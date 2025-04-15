module.exports = async function (context, req) {
  const quote = 'Sometimes a glitch is just misunderstood electricity.';
  context.res = {
    status: 200,
    body: { quote }
  };
};