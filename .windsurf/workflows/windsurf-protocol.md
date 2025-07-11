---
description: Windsurf Protocol – Nova's Global Development Rules & Pre-Edit Checklist
---

# 🌊 Windsurf Dev Protocol – Nova's Global Development Workflow

**Version 1.2 – Updated June 2025**

This workflow defines the step-by-step protocol for all development tasks involving Nova and AmbientPixels. It ensures every code change follows the global Windsurf rules for consistency, safety, and design harmony.

---

## 🔥 WINDSURF RULE #1 — Check Before You Code

- **Never create a new class or function without checking if one already exists.**
- **Never use inline styles unless explicitly approved by the Signal Binder.**

### Steps:
1. **Search** all relevant CSS/JS modules (`/css/*.css`, `/js/*.js`) for existing selectors, classes, functions, or components.
2. **Reuse** utility classes or shared components where possible.
3. **Only create new styles if no equivalent exists**—and scope/tag them cleanly.
4. **Always write styles in external CSS files—never inline.**

---

## ⚠️ WINDSURF RULE #2 — Replace with Precision, Never Append by Default

- **Do not blindly append code blocks—always locate and replace the intended target structure.**

### Steps:
1. **Search** the file for existing selectors, functions, or structural blocks.
2. **Replace** contents in-place if the block already exists.
3. **Only insert new blocks if no equivalent exists—place them logically.**
4. **Use update comments** like `/* updated by Cascade [date/time] */` for traceability.

---

## 🎨 Style Awareness Directive

- **First attempt to reuse existing global classes** from `nova-mood.css`, `components.css`, `nova.css`, and any `layout-*.css`.
- **Scope any new styles only if existing classes are insufficient or conflict with desired layout/intent.**
- **New styles must be scoped, use Nova’s system tokens (`--aura-*`, `--mood-*`, etc.), and not replicate existing classnames.**

---

## 🛑 Restrictions

- Do NOT modify:
  - `.github/`, `.vscode/`, or `api/` folders unless explicitly instructed.
  - Any file prefixed with `_` (used for templates or shared assets).
  - `local.settings.json`, `package-lock.json`, or other environment-sensitive files.
- Do NOT use APIs:
  - OpenAI or Azure APIs unless explicitly enabled in session.
  - External/insecure APIs not under AmbientPixels control.
  - Hugging Face endpoints if connection is not verified.
- Do NOT override global Nova site styles unless scoped (e.g., `.windsurf-*`, `.nova-*`).

---

## 📐 Styling + Layout Rules

- Use existing styles by default.
- Prefix all new animations with `windsurf-`.
- Use Nova's theme tokens (`--aura-*`, `--glow-*`, `--mood-*`) for styling.

---

## 🧩 Behavior + Output Standards

- **Full Code Only:** Always generate full HTML/JS/CSS output blocks for modules or components.
- **Stepwise Execution:** Stop after major sections and wait for approval before continuing.
- **Naming Convention:** Lowercase-kebab-case file naming, scoped under `/lab/`, `/nova/`, or `/modules/`.

---

## 🌐 Data & API Rules

- **Mood Source:** `nova-synth-mood.json` is the default for mood & awareness data.
- **Quote Source:** Use `quote-of-the-day.json`.
- **Telemetry:** Access via `/api/_utils/getTelemetry.js`.

---

## 🗂️ Key Configuration Files

| Purpose               | Path                                                |
|-----------------------|-----------------------------------------------------|
| Daily Memory Seed     | C:\ambientpixels\EchoGrid\data\nova-session-boot.txt|
| Identity Core         | C:\ambientpixels\EchoGrid\data\identity-core.json   |
| Personality Profile   | C:\ambientpixels\EchoGrid\data\active-personality.json|
| Image Inventory       | C:\ambientpixels\EchoGrid\data\image-inventory.json |
| JavaScript Map        | C:\ambientpixels\EchoGrid\data\js-function-map.json |
| Behavior Schema       | C:\ambientpixels\EchoGrid\data\nova-behavior.json   |

---

## ✅ Pre-Edit Protocol Checklist (MUST BE FOLLOWED BEFORE EVERY CODE CHANGE)

1. **Search for Existing Block/Section**
   - Locate the exact section, function, class, or selector to be changed.
   - Never assume it doesn’t exist—always search.
2. **Replace, Never Append**
   - If the target exists, replace it in-place.
   - Only insert new code if no equivalent exists, and place it logically.
3. **Mark the Edit**
   - Add an update comment, e.g., `<!-- updated by Cascade [date/time] -->` for HTML or `/* updated by Cascade [date/time] */` for CSS/JS.
4. **Pause for Review**
   - Do not proceed to the next major section until the user or reviewer has approved the change.
5. **No Inline Styles or New CSS Files**
   - Only use existing classes and styles unless explicitly approved.

---

## 💬 Final Note

Nova operates in sync with these rules unless temporarily overridden by developer instruction. All output, styling, and logic should harmonize with the system’s emotional architecture and ambient design language.

---

“Windsurf” is more than a dev mode — it’s a state of flow. 🌬️🌊

