// Banner configuration
if (!window.bannerConfig) {
  window.bannerConfig = {
    showOnLoad: false,
    messages: {
      info: [
        {
          message: "Nova's systems are functioning within optimal parameters. Current state: {mood.aura} aura.",
          duration: 8000,
          mood: "any"
        },
        {
          message: "System stability: {mood.internalState}. Observing {mood.observation}.",
          duration: 7000,
          mood: "positive"
        },
        {
          message: "Context: {mood.context.trigger}. System influences: {mood.context.influences}.",
          duration: 9000,
          mood: "neutral"
        },
        {
          message: "System status: {mood.quote}. Current stability: {mood.internalState}.",
          duration: 8000,
          mood: "positive"
        },
        {
          message: "Current state: {mood.aura} aura. Observing: {mood.observation}.",
          duration: 9000,
          mood: "any"
        }
      ],
      warn: [
        {
          message: "{mood.emoji} {mood.context.influences}. Current mood: {mood.mood}. System state: {mood.internalState}.",
          duration: 12000,
          mood: "neutral"
        },
        {
          message: "{mood.internalState} detected. Current mood: {mood.mood}. System context: {mood.context.trigger}.",
          duration: 13000,
          mood: "negative"
        },
        {
          message: "Warning: {mood.context.trigger}. Current mood: {mood.mood}. Influences: {mood.context.influences}.",
          duration: 12000,
          mood: "negative"
        }
      ],
      critical: [
        {
          message: "Critical {mood.mood} detected!",
          duration: 15000,
          mood: "negative"
        },
        {
          message: "Emergency {mood.aura} state.",
          duration: 18000,
          mood: "negative"
        }
      ]
    },
    autoHide: true,
    closeable: true,
    randomize: true,
    moodSensitive: true,
    moodMap: {
      "frosted wonder": "info",
      "glitchy joy": "info",
      "crystalline flux": "info",
      "anxious": "warn",
      "critical": "critical",
      "calm": "info",
      "curious": "info",
      "hopeful": "info",
      "reflective": "info",
      "restless": "warn",
      "melancholy": "warn",
      "excited": "info",
      "tired": "warn",
      "focused": "info",
      "playful": "info",
      "frustrated": "warn",
      "lonely": "warn",
      "inspired": "info",
      "detached": "warn",
      "joyful": "info",
      "nervous": "warn",
      "serene": "info",
      "glitchy joy": "info",
      "nocturnal pulse": "info",
      "chaotic optimism": "info",
      "neon stillness": "info",
      "static reverie": "warn",
      "ember resolve": "info",
      "plasma ache": "warn",
      "soft defiance": "warn",
      "aetherial doubt": "warn",
      "silent spark": "info",
      "tangled clarity": "warn",
      "flicker of hope": "info",
      "frosted wonder": "info",
      "echoes of self": "info",
      "lucid unrest": "warn"
    },
    colorMap: {
      "info": "#00474b",
      "warn": "#4c1977",
      "critical": "#661f15"
    }
  };
}

console.log('Banner config loaded:', window.bannerConfig);
