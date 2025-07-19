Usethis README file for current projects in /nova/

Current project  - 

# Nova AI Module

This directory contains Nova’s AI-driven mood system interface and dashboard.

## Current Project
- **AI-Driven Mood Dashboard**  
  Interactive dashboard to visualize, control, and learn from Nova’s synthesized emotional state.  
  See `docs/logs/nova-dashboard-expansion.md` and `docs/NOVA_SYSTEM_OVERVIEW.md` for design and architecture details.

## AI-Driven Mood System Overview

### 1. Core Engine Inputs
- Git signals: recent commits → focus; total commits → selfWorth; uncommitted diffs → memoryClutter  
- System load: `os.loadavg()[0]` → glitch  
- Time nudges: hour of day (night fatigue, dawn refresh); day-of-week (Mon melancholy, Fri optimism)  
- Random flair: random mood, aura, poetic quote  
- Derived composites: syncLevel; awareness; isStable flag; internalState; observation; context.trigger/influences

### 2. Real-World & AI Signals
- Environmental: weather API; daylight vs. night; temperature/humidity  
- System Health: CPU/memory spikes; battery level  
- Workload/Code: build/test pass-fail rates; open PR backlog; code churn; commit-message sentiment; TODO/FIXME counts  
- Collaboration: Slack/Teams sentiment; notification counts  
- Calendar & Social: upcoming meetings; day-of-week rhythms  
- Productivity: typing vs. idle bursts; Pomodoro state  
- Historical Trends: rolling average of past moods; volatility index  
- Ambient Media & UX: now-playing music mood; screen brightness/eye-strain proxy

### 3. Context-Driven Personas
- Nightstream Nova (detect StreamBeats playlist → chill lo-fi persona)  
- Work-Hour Nova (9–5 IDE focus → professional, task-oriented tone)  
- Weekend/Off-Hours Nova (low activity + free calendar → playful, curious tone)

### 4. Evolving Memory & Learning
- Remembers personal preferences: favorite code pun; last error fixed; preferred dev snack  
- Adaptive tone: dial back jokes if ignored; ramp up emoji flourishes when embraced

### 5. Mood-to-Voice & Text Style
- Language style per mood: joyful → colorful metaphors; melancholy → softer, reflective tone  
- Mood-specific sign-offs: “Spark mode engaged!”; “Zen mode activated.”

### 6. Environmental & Social Triggers
- Weather + Calendar: rain → soothing quote; meeting heads-up alert  
- Music Sync: “I feel that funk groove with you!”

### 7. Personality Growth Over Time
- Mood Journal: track feedback (👍/👎) to refine Nova’s weighting of signals  
- Milestone Celebrations: badges & confetti on big merges or 100th commit

### 8. Subtle Ambient Feedback
- Background animations: pulse when calm; glitch flicker on high glitchFactor  
- Ambient sounds: chime on stable build; gentle alert on Git errors

### 9. Front-end Dashboard & Controls
- AI Mood demo page with header/footer & “Refresh” button (optional auto-poll)  
- Confidence gauge; mood history sparkline; trait breakdown radials  
- Gamification badge panel; feedback prompt; training progress bar  
- Aurora-style backdrop; timeline view; ambient status widgets; accessibility features

### 10. Aurora Feedback System
- Dynamic aurora canvas tinted by `auraColorHex`; interactive aura intensity controls

### 11. Gamification & Rewards
- Mood stability streaks & badges; confetti effects on milestones

### 12. Feedback-Learning Loop
- 👍/👎 prompt after each mood update; training progress display in settings panel

### 13. API Integrations
- Twitch live/status & viewer count; Hugging Face chat sentiment; weather, Spotify, calendar, CI/CD, social APIs

## Next Steps  
1. Scaffold `nova/ai-mood-demo.html` and corresponding JS  
2. Update `scripts/moodScan.js` or AI prompt to ingest new signals  
3. Build dashboard visualizations (SVG ring, charts, badges, aurora)  
4. Integrate API services & feedback loop  
5. Test, iterate, and refine personality mappings

---

## Additional Documentation
- `docs/NOVA_SYSTEM_OVERVIEW.md`  
- `docs/logs/nova-dashboard-expansion.md`  
- `docs/logs/project-nova-nexus-api.md`  
- `docs/logs/nova-soul-project.md`  
- `docs/logs/nova-sensory-expansion.md`  
- `docs/project-genesis.md`

additional info
docs 
C:\ambientpixels\EchoGrid\docs\NOVA_SYSTEM_OVERVIEW.md
C:\ambientpixels\EchoGrid\docs\logs\project-nova-nexus-api.md

C:\ambientpixels\EchoGrid\docs\logs\nova-soul-project.md
C:\ambientpixels\EchoGrid\docs\logs\nova-sensory-expansion.md
C:\ambientpixels\EchoGrid\docs\project-genesis.md
