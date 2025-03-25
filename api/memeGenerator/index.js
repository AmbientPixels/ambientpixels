module.exports = async function (context, req) {
  const token = req.headers['authorization']?.split(' ')[1];
  const prompt = req.body?.prompt;

  if (!token || token !== process.env.ACCESS_TOKEN) {
    context.res = { status: 403, body: "Forbidden: Invalid token" };
    return;
  }
  if (!prompt) {
    context.res = { status: 400, body: "Bad Request: Prompt required" };
    return;
  }

  const imageUrl = "https://placehold.co/300x300?text=" + encodeURIComponent(prompt);
  const captions = { top: "MEME", bottom: prompt.slice(0, 10) };

  context.res = {
    status: 200,
    body: { imageUrl, captions }
  };
};