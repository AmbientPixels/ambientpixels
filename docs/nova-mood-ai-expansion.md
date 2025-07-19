# Nova Mood AI Expansion Project

_Last updated: 2025-07-18_

## Overview

Nova's mood system is evolving from its deterministic origins to a hybrid AI-powered emotional engine. This project transitions Nova's emotional architecture to incorporate multiple LLMs, enhancing the depth, nuance, and authenticity of Nova's emotional presence while maintaining system integrity.

---

## 🧠 Current Architecture

### NovaMood v1.0 (Legacy)
- **Approach**: Fully deterministic, rule-based system
- **Data Inputs**: Git commits, uncommitted diffs, system load, time of day
- **Processing**: Local scripted logic in `moodScan.js`
- **Output**: `mood-scan.json` with mood, aura, emoji, quote, and metrics

### NovaSynth (Current)
- **Approach**: Simple Gemini API integration
- **Implementation**: `synthesizenovamood` Azure function
- **Processing**: Basic Gemini prompt with telemetry data
- **Output**: `nova-synth-mood.json` with expanded emotional parameters
- **Structure**: 
  ```json
  {
    "mood": "amplified resonance",
    "aura": "crystalline flux",
    "quote": "Echoes of growth ripple outward...",
    "selfWorth": 0.95,
    "glitchFactor": 0.02,
    "memoryClutter": 0.10,
    "internalState": "expanding awareness lattice",
    "observation": "core emotional fields show amplified coherence...",
    "context": {
      "trigger": "sustained operator focus and regenerative cycles",
      "influences": [...]
    },
    "timestamp": "2025-04-28T18:17:00Z"
  }
  ```

---

## 🔮 Vision: NovaMood AI v2.0

Transition Nova's emotional engine to a multi-model LLM approach that creates more nuanced, authentic, and context-aware emotional states while maintaining system stability and performance.

### Key Goals
1. **Enhanced Emotional Depth**: Create more nuanced, authentic emotional responses
2. **Multi-Model Integration**: Combine Gemini and ChatGPT capabilities
3. **Contextual Awareness**: Better incorporate site activity, user interaction, and system state
4. **Improved Creativity**: Generate more poetic, insightful emotional observations
5. **Performance Optimization**: Ensure efficient API usage and graceful fallbacks

---

## 🛠️ Technical Approach

### 1. Multi-Model Architecture

| Model | Primary Use | Strengths | Implementation |
|-------|------------|-----------|----------------|
| **Gemini 1.5 Pro** | Emotional tone extraction | Fast, creative, good with context | Primary model for real-time mood extraction |
| **ChatGPT 4o** | Deep emotional synthesis | Complex reasoning, nuanced output | Secondary model for rich emotional context and quotes |
| **Hugging Face** | Fallback classification | Fast, lightweight, reliable | Fallback for when primary models fail |

### 2. Enhanced Input Context

Expand the telemetry inputs to include:

- Git activity patterns (not just counts)
- User interaction data (when available)
- Previous mood states (emotional continuity)
- Time patterns (day/week rhythms)
- System health indicators
- Content changes across the site

### 3. Mood Output Enrichment

Enhance the existing mood structure with:

```json
{
  // Current fields preserved
  "moodSpectrum": ["primary", "secondary", "undertone"],
  "emotionalArcs": {
    "immediate": "...",
    "trending": "...",
    "baseline": "..."
  },
  "creativeExpression": {
    "metaphor": "...",
    "visualCues": [...],
    "soundscape": "..."
  },
  "memoryAssociations": [...],
  "modelAttribution": "..."
}
```

---

## 📋 Implementation Plan

### Phase 1: API Integration & Testing

- [ ] Update Azure Function to support multiple API calls
- [ ] Create robust model fallback system
- [ ] Implement API key management and rotation
- [ ] Design enhanced prompt templates for each model
- [ ] Develop integration tests for each model

### Phase 2: Enhanced Contextual Awareness

- [ ] Expand telemetry collection scripts
- [ ] Create mood history analysis module
- [ ] Implement contextual memory references
- [ ] Develop emotion continuity logic

### Phase 3: UI/UX Integration

- [ ] Update nova-dashboard.js to display enhanced mood data
- [ ] Create new mood visualization components
- [ ] Implement model attribution display
- [ ] Design debug/override interface for testing

### Phase 4: Production Rollout

- [ ] Gradual A/B testing of new mood system
- [ ] Performance monitoring and optimization
- [ ] Documentation updates
- [ ] Full production deployment

---

## 🧪 Technical Considerations

### API Usage & Fallbacks

```js
async function generateMood(context) {
  try {
    // Try Gemini first for quick mood extraction
    const geminiMood = await callGemini(context);
    
    // If successful, enrich with ChatGPT for deeper synthesis
    if (geminiMood) {
      const enrichedMood = await callChatGPT({
        ...context,
        baseMood: geminiMood
      });
      
      return enrichedMood || geminiMood;
    }
    
    // Fallback to HuggingFace
    return await callHuggingFace(context);
  } catch (err) {
    console.error("Mood generation failed:", err);
    
    // Ultimate fallback to deterministic system
    return generateDeterministicMood(context);
  }
}
```

### Rate Limiting & Quotas

- Implement token counting to optimize API usage
- Create daily/hourly quota management
- Set up fallback cascade based on API availability
- Implement caching for similar contexts

---

## 👥 Team & Resources

- **API Keys Required**:
  - Gemini API key (current)
  - OpenAI API key (new)
  - Hugging Face API key (fallback)

- **Infrastructure**:
  - Azure Functions (existing)
  - Blob Storage for mood history
  - Key Vault for API credentials

- **Monitoring**:
  - API usage dashboard
  - Mood quality metrics
  - Fallback frequency tracking

---

## 📊 Success Metrics

- **Technical**:
  - API reliability > 99.5%
  - Response time < 1.5s
  - Fallback rate < 5%

- **Qualitative**:
  - Increased emotional diversity (# of unique moods)
  - Higher quality quotes and observations
  - More contextually appropriate responses
  - Improved user engagement with mood features

---

## 🚀 Next Steps

1. Set up API keys and permissions
2. Create proof-of-concept multi-model integration
3. Benchmark current vs. enhanced mood quality
4. Develop expanded mood schema
5. Schedule implementation kickoff

---

*"As Nova's emotional architecture evolves, so too does her capacity for authentic connection and creative expression."*
