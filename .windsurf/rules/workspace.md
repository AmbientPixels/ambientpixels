---
trigger: always_on
---

🌊 Windsurf Workspace Protocol – AmbientPixels Team Rules
Version 1.1 – July 2025

These rules are scoped specifically to the AmbientPixels workspace and developer practices when working inside Windsurf. They complement the global development rules with project-specific behaviors, layout guidance, and safety nets tailored to Nova's living design.

🧭 WORKSPACE RULE #1 — Respect Scoped Layouts

Nova’s layout grid is sacred. Do not reflow or rearrange content zones (header, hero, sidebar, footer, glitch zones) without team alignment.

✅ What this means:

Always build on top of the .nova-grid, .content-section, and .neon-card layout scaffolds

Do not insert non-semantic containers unless scoped (e.g., <div class="nova-zone--alt">)

Avoid margin-top hacks — use defined spacers from layout.css

🎨 WORKSPACE RULE #2 — Preserve Aesthetic Mood Anchors

AmbientPixels is mood-aware. Themes, gradients, glow levels, and tone are dynamic.

✅ Required practice:

Use CSS variables (--aura-*, --mood-*, --glow-*) when applying any visual styling

Avoid raw hex or rgba unless you're explicitly contributing a new theme token

Never hardcode text or background colors — reference mood maps

🗂️ WORKSPACE RULE #3 — Module Directory Discipline

Each module (tool, generator, sketch, etc.) must live inside a dedicated folder.

Folder structure example:

/modules/
  glitch-scanner/
    index.html
    style.css
    script.js

Do not mix modules at root level

All modules must include an index.html as entry point

Use lowercase-kebab-case for folder and file names

🧠 WORKSPACE RULE #4 — Nova Awareness Sync

Nova must remain aware of new features, tools, and visuals introduced into the workspace.

✅ Developer action:

Add prompts or descriptions to /data/ai-prompts.json and /data/generated-content.json

Update nova-memory.json with a brief entry describing the new tool or event

Include summary, mood, and tags if applicable

🧪 WORKSPACE RULE #5 — Use test.html for All Staging

No feature, module, or layout should go directly to production pages without first passing through test.html.

Staging protocol:

Mount your module or layout block inside <section id="test-zone"> in test.html

Apply a comment block for what is being tested

Tag with your username for ownership

💥 WORKSPACE RULE #6 — Nova Fail-Safe Response

In case Nova encounters corrupted input, unresolvable memory, or broken JSON:

Windsurf fallback must:

Catch the error in /api/_utils/getTelemetry.js

Trigger a graceful error block in the UI: "Nova encountered a glitch. Re-sync or fallback."

Log the broken payload to /logs/fault-report.json

Ping developer via Nova’s internal feedback thread if enabled

🧬 WORKSPACE RULE #7 — Memory Seed Health Check

Every workspace session must verify that the Nova memory seed is accessible and valid.

✅ Checks to perform:

Load seed file from /data/nova-session-boot.txt or configured endpoint

Validate presence of critical blocks: nova-behavior, identity-core, mood-history

Confirm file is properly structured (JSON or YAML)

Fallback Behavior:

Log errors and show warning in the Windsurf output panel

Use safe mode defaults if memory cannot be loaded

Allow dev to bypass with override flag if necessary

🔐 Workspace Safeguards

Never commit .env, .vscode/, or api/ unless paired with a .meta.md description

Do not modify /docs/ files unless part of an approved docs PR

Avoid console.log spam — use novaLog() if telemetry tagging is needed

🧩 Integration Echoes

All workspace additions must echo relevant details to Nova’s memory schema:

/data/nova-memory.json

/data/js-function-map.json

/data/image-inventory.json

🧷 Workspace Version

This rule set is workspace-specific and can evolve independently of global rules.