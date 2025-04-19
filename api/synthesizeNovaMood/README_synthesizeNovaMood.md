# 📁 /api/synthesizeNovaMood/

## 🧠 NovaSoul: Mood Engine

This Azure Function synthesizes Nova's emotional state by combining structured telemetry with natural language emotion analysis. It outputs a full mood payload (`nova-synth-mood.json`) used to influence Nova's UI, tone, and behavior across the site.

---

## 🔧 Function Overview

- **Input**: Telemetry + mood prompt (e.g. `"System check complete. Awaiting user..."`)
- **Output**: JSON mood state including:
  - `mood`, `aura`, `drift`, `intensity`
  - `selfWorth`, `mentalClutter`, `internalState`

---

## 🧬 Current AI Model

- **Source**: Hugging Face  
- **Model**: [`j-hartmann/emotion-english-distilroberta-base`](https://huggingface.co/j-hartmann/emotion-english-distilroberta-base)  
- **Use Case**: Lightweight, reliable emotion classification for quick mood synthesis

---

## 🔮 Dynamic AI Routing (Planned)

NovaSoul will soon support dynamic model routing. Based on context, Nova will choose:

| Model     | Use When...                              |
|-----------|-------------------------------------------|
| **Gemini** | High mood complexity or poetic input       |
| Hugging Face | Fast, fallback, or simple mood detection |
| OpenAI    | Deep synthesis (fallback for now)          |

You’ll be notified in logs when Gemini is used.

---

## 🧪 Testing

Local run:
```bash
curl -X POST http://localhost:7071/api/synthesizeNovaMood \
  -H "Content-Type: application/json" \
  -d '{"input": "Codebase is quiet. GitHub pulse is low. Awaiting spark."}'
```

---

## 📄 Output Example
```json
{
  "mood": "calm",
  "aura": "soft blue",
  "drift": "still",
  "intensity": 0.3,
  "selfWorth": 0.8,
  "mentalClutter": 0.1,
  "internalState": "watching"
}
```