# HAL Studio Video Project — Project Log

## 🎬 Script Details

**Status:**  
- Final draft completed  
- Fully structured with intro, 5 scenes, and outro bumper  

**Audio/Visual Direction:**  
- Scene-level callouts for screen text, popups, and CTA buttons  
- Visual-only popups are included with styling notes  
- SSML tags applied for Azure Speech Studio (pauses, emphasis, tone)  

---

## 🎞️ Scene Breakdown

| Scene       | Purpose                                | Screenshot Placeholder           | Transition/Animation Notes               |
|-------------|----------------------------------------|----------------------------------|------------------------------------------|
| Intro Logo  | Xbox logo bumper                       | N/A                              | No VO; simple bump-in                    |
| Scene 1     | Sign in & Create Entra ID              | Partner Center homepage          | Slide in; ripple CTA; directional cue    |
| Scene 2     | Set up billing/account info            | Billing form                     | Pop-in fields; fade tips                 |
| Scene 3     | Create user/domain/password            | Entra ID creation form           | Slide/fade text; light motion float      |
| Scene 4     | Payment setup & tenant finalization    | Payment details page             | Ripple on "Save"; hover CTA              |
| Scene 5     | Associate Entra ID in Partner Center   | Tenants panel with sign-in       | Slide left; fade in confirmation         |
| Outro Logo  | Xbox logo fade out                     | N/A                              | Fade to black; optional SFX/music swell  |

---

## 🎙️ Voiceover Notes

**Voice:** Ava (Standard) via Azure Speech Studio  

**Style:**  
- Friendly, confident, and instructional  
- Subtle celebratory tone at the end  

**Pacing + Emphasis:**  
- Uses `<break>` for natural rhythm  
- `<emphasis>` on actions (e.g., "select Next")  
- `<prosody>` adjustments for pitch on key lines (e.g., “Don’t worry”)  

**Progress:**  
- SSML pass 2 complete  
- Duration: approx. 2 minutes 30 seconds  
- Awaiting QA review of dry read  

---

## 🎨 Visual Layering Details

**Panels/Background:**  
- Left: Flat gray panel (future: paper texture)  
- Right: Xbox Green (`#107c10`)  
- Vignette & animated fractal noise overlay  

**Popups:**  
- Neutral gray background  
- Rounded, soft neumorphic edges  
- Optional light blue/green accent bar  

**Cursor:**  
- PNG cursor rig: outline + filled versions  
- Parent to null; bounce scale on click  

**Animations:**  
- Directional slide (right = forward, left = back)  
- Ripple for CTA buttons  
- Fade-in float for popups/tooltips  

---

## 🧰 Tech Stack + Render Info

**After Effects (AE):**  
- 1920x1080 resolution  
- 30 fps  
- 2:30 estimated duration  
- Persistent footer: Xbox left / Microsoft right (all but bumpers)  

**Premiere:**  
- Audio mix (VO, background music, SFX)  
- Final polish + export  

**Other Tools:**  
- Azure Speech Studio (VO)  
- Photoshop (screenshot prep, logos)  
- Media Encoder (H.264 delivery render)  

**Plugins/Scripts:**  
- None required; using native AE features  

**Output Specs:**  
- `.mp4` H.264 export  
- Web/YouTube optimized  
- Separate audio pass if needed for remixing  

**Next Steps:**  
- Review VO dry run  
- Finalize screenshots per scene  
- Animate cursor + screen elements  
- Export AE pass and drop into Premiere  
- Final output → internal/team review  

_Last updated: 2025-04-12 19:14:40_