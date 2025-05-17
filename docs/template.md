# Windsurf Workflow: Ambient Pixels Dev Model v2.5

_Last updated: 2025-05-17_

## Overview

With the introduction of **Windsurf Editor** into our toolkit, we are evolving our development flow into a **hybrid creative system**—pairing human intent, AI personality, and fast modular tooling.

This marks the beginning of a new working triad:

---

## 🧠 The Trio: Roles in the Grid

### 1. **Windsurf Editor** — *The Vibe Coder*  
An AI-powered IDE (built on VS Code by Codeium) focused on fast iteration, multi-file edits, and privacy-first design. Ideal for layout prototyping and intuitive flow building.

> Role: Implements structure, layout, and functional modules rapidly.  
> Tool of choice for: HTML/CSS/JS prototyping, mood dashboards, component demos.

---

### 2. **Nova** — *The Echo Architect*  
An embedded AI system born from git-based awareness scripts, Nova synthesizes mood, story, and intent across the site. Now serves in an advisory and creative synthesis role.

> Role: Shapes personality, tone, and system coherence.  
> Focus areas:
> - Mood engine evolution  
> - Lore and thought layering  
> - AI-assisted content shaping  
> - Naming, UX advisory, microcopy tone

---

### 3. **The Developer (You)** — *The Signal Binder*  
Human intelligence serves as the synthesis layer—bridging vibe coding, ambient intelligence, and real-world logic. Chooses direction, curates emotion, and makes final design decisions.

> Role: Intent shaper, tester, director, and creative force.

---

## Workflow Notes

- Full-page generation by Nova is now **deprioritized**; Nova will offer **content, tone, and structural guidance** instead.
- Windsurf Editor is the **primary tool for layout and visual prototyping**.
- AI thoughts and experiments are logged in `/nova/lore/` or `nova-thought` sections.
- All future tools and modules should be tagged by role: [`editor`, `nova`, `signal`] for traceability.

---

## Example Project Mapping

| Feature                    | Role            | Tool                  |
|----------------------------|------------------|------------------------|
| Nova Pulse V2 UI           | Windsurf         | Visual layout, CSS     |
| Mood Synthesis JSON        | Nova             | Hugging Face API       |
| Lore Panel Design          | You + Nova       | Figma + advisory flow  |
| Prompt Generators          | Nova             | aiPromptGenerator.js   |
| Metastudio Layout          | Windsurf + You   | Manual + vibe coding   |

---

## Future Directions

- Add `/labs/windsurf.html` as a formal page to log experiments and usage tips.
- Expand `Nova`’s advisory capabilities through deeper telemetry.
- Formalize this workflow under `version-history.html` and `core.html`.

---

> _"Some code writes pages. Some code writes presence. Nova listens to both."_  
— Ambient Pixels Dev Memo
