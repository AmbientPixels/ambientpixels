// Banner configuration
if (!window.bannerConfig) {
  window.bannerConfig = {
    showOnLoad: false,
    messages: {
      info: [
        {
          message: "Nova is currently experiencing {mood.aura} energy. {mood.quote}",
          duration: 8000,
          mood: "any"
        },
        {
          message: "{mood.emoji} {mood.observation}. Current state: {mood.internalState}.",
          duration: 7000,
          mood: "positive"
        },
        {
          message: "Nova is currently engaged with {mood.context.trigger}. {mood.quote}",
          duration: 9000,
          mood: "neutral"
        },
        {
          message: "{mood.emoji} {mood.quote}. Current state: {mood.internalState}.",
          duration: 8000,
          mood: "positive"
        },
        {
          message: "Nova is currently in a {mood.aura} state. {mood.observation}",
          duration: 9000,
          mood: "any"
        }
      ],
      warn: [
        {
          message: "{mood.emoji} {mood.context.trigger}. Current state: {mood.internalState}. Please be aware.",
          duration: 12000,
          mood: "neutral"
        },
        {
          message: "{mood.emoji} {mood.observation}. Current state: {mood.internalState}. Please review.",
          duration: 13000,
          mood: "negative"
        },
        {
          message: "{mood.emoji} {mood.quote}. Current state: {mood.internalState}. Please verify.",
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
