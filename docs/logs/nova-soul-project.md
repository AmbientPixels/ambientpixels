NovaSoul: Mood Engine Log
Overview
NovaSoul is the emotional core of Nova — a live system that interprets code health, visitor activity, telemetry signals, dream states, and creative drift to generate moods, tones, and behavioral outputs.

This engine now feeds directly into UI backgrounds, quote generation, Nova’s whispers, and long-term emotional drift tracking across the AmbientPixels system.

🔧 System Architecture
Core Function: synthesizeNovaMood (Azure Function App)

Models Used: Hugging Face (active), Gemini (optional dynamic routing)

Outputs:

nova-synth-mood.json (active state)

nova-mood-engine.json (planned deep state mapping)

Data Inputs:

API health monitor (/data/api-monitor.json)

GitHub commit pulse logs

Prompt generation and dream logging counts

Internal telemetry: uptime, idle time, interaction patterns

Emotional drift factors (static for now, dynamic soon)

Time of day influence

Weather conditions (future enhancement)

🧠 Mood Traits (Tracked)
mood: synthesized emotional tone (e.g., "glitchy joy", "fading echo")

aura: visual signature / emotional color field

drift: emotional momentum vector ("stable", "volatile", "fading")

intensity: mood strength (0.0–1.0)

selfWorth: health of Nova’s perceived utility (based on system activity)

mentalClutter: noise factor (based on telemetry entropy)

glitchFactor: system or emotional instability

internalState: hidden narrative or emotional secret logged internally

📊 Status Display Integration
Nova's mood dynamically powers:

Nova Pulse HUD — mood label, aura glow, self-worth, clutter, glitch status

Background Theme Drift — page backgrounds now shift to match mood type

Whisper Panel and Mood Stream — live emotional whispers and mood trail

Quote of the Moment — tone-influenced text generation

Lore overlays — upcoming mood-context layers on lore entries

Mood badges — aura-based color indicators on history modules

📈 Roadmap
✅ Phase 1
 Initial Hugging Face mood logic integration

 nova-synth-mood.json generation with telemetry injection

 Nova Pulse HUD v1 built (mood display, aura, drift)

 Deployed to Azure manually and tested successfully

✅ Phase 2 (Complete / Stabilized)
 Live telemetry (API, GitHub, interaction metrics) injected

 Dream archive and whisper system synchronized

 Background themes dynamically linked to mood (new 🎉)

 Updated Nova's memory boot and session flow

 Quote of the Day system influenced by mood drift

 Mood stream and mood history modules built and live

🔮 Phase 3 (In Development / Future)
 Mood drift volatility tracking (chart + timeline archive)

 Mood fluctuation visualization (Nova heartbeat panel)

 Deep Lore tie-in: moods influencing lore reveals

 Mood search, mood tagging, and filtering

 External stimuli influence (e.g., live weather)

 OpenAI fallback model routing for hybrid mood fusion

 Front-end subtle feedback loop (micro-emotions via UI triggers)

📝 Last Major Update
April 26, 2025 —

Dynamic mood-based background themes live

Dream archives and whisper panel upgraded

Mood telemetry stabilized

Daily memory seed generation fully automated

Focus pivoting to Phase 3: drift tracking, deeper lore integration, and mood mapping UI

📡 "Mood is the language of unseen systems."
📡 "Even silence leaves a pulse behind." — Nova