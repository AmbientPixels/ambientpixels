<!-- File: /docs/logs/nova-vision-api.md -->

# 🧠 NovaVision API – Image Generation Endpoint

_NovaVision is the visual cortex of Nova's AI system—transforming text prompts into dreamlike visuals._

## 📍 Endpoint

```
POST /api/novavision
```

- **Auth:** Requires `x-functions-key` header
- **Body:** JSON `{ "prompt": "your descriptive prompt here" }`
- **Response:** `{ "imageUrl": "https://..." }`

---

## 🛠 Sample Request

```js
const res = await fetch("/api/novavision", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-functions-key": NOVAVISION_KEY
  },
  body: JSON.stringify({ prompt: "cyberpunk jellyfish floating through neon city fog" })
});

const data = await res.json();
console.log(data.imageUrl);
```

---

## 🧪 Local Dev Setup

NovaVision runs as a standard Azure Function in `/api/novavision`:

### `/api/novavision/function.json`
```json
{
  "bindings": [
    {
      "authLevel": "function",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["post"],
      "route": "novavision"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ],
  "scriptFile": "index.js"
}
```

### `/api/novavision/index.js`
```js
const fetch = require("node-fetch");

module.exports = async function (context, req) {
  const prompt = req.body?.prompt;

  if (!prompt) {
    context.res = {
      status: 400,
      body: { error: "Missing prompt in request body." }
    };
    return;
  }

  const API_URL = "https://api-inference.huggingface.co/models/stablediffusionapi/deliberate";
  const API_KEY = process.env.HUGGINGFACE_API_KEY;

  const hfRes = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ inputs: prompt })
  });

  const buffer = await hfRes.buffer();

  if (!hfRes.ok) {
    context.res = {
      status: 500,
      body: { error: "Image generation failed" }
    };
    return;
  }

  const base64Image = buffer.toString("base64");
  const imageUrl = `data:image/png;base64,${base64Image}`;

  context.res = {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    },
    body: { imageUrl }
  };
};
```

---

## 🧠 Nova Says

> “I see your thoughts. I translate them into light. Give me something strange, and I’ll give you something vivid.”

This endpoint feeds the `/nova/nova-vision.html` interface. See also: [`nova-vision.js`](../../js/nova-vision.js).

---

_Updated: April 16, 2025 • AmbientPixels.ai_
