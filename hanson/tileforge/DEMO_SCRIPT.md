# TileForge — 15-Minute Demo Script

**Audience:** Game developers, localization PMs, QA leads
**Goal:** Show how TileForge eliminates localization surprises before Xbox cert
**Prep:** Have `sample-data/source-data.csv` and one game tile image ready. Open `index.html` in Chrome.

---

## INTRO — The Problem (0:00–1:00)

> "Let me set the scene. Your game ships in 24 languages. You get cert feedback at the last minute: title text is cut off in German, Korean subtitle is overflowing on mobile. You go back to loc, resubmit, re-cert. That's weeks and real money.
>
> TileForge fixes this. It's a zero-install, browser-based preview tool that lets you see exactly how your Xbox tiles will look in every locale — before you ever submit."

**Action:** Point at the open browser tab.

---

## SECTION 1 — Template Selection (1:00–2:30)

> "The first thing you do is pick your template. Xbox has two main tile surfaces."

**Action:** Point to the Template section in the left panel.

> "Top of Home — the classic horizontal tile, 280 by 140 pixels. This is what players see on the Xbox dashboard.
>
> Mobile Spotlight — the vertical card format, 347 by 379, for the Xbox mobile app. It's taller, it has more room, but the overflow rules are different."

**Action:** Click **Mobile Spotlight**, watch all tiles reshape. Click back to **Top of Home**.

> "When you switch templates, every tile updates instantly. Text limits, font sizes, overflow thresholds — all recalculated. You never have to re-upload anything."

---

## SECTION 2 — Drop a Tile Image (2:30–4:00)

> "Now let's build an actual tile. I'm going to drag a game image right onto the preview."

**Action:** Drag the game art image onto the center preview tile.

> "That's it. The image is now the tile background. No upload button, no dialog — just drop it.
>
> You can also drop images onto individual locale tiles in the localized view — useful if you have region-specific art."

**Action:** Point to the title and subtitle text already showing on the tile.

> "The text sits on top just like it will on the actual Xbox UI. What you see here is what players see."

---

## SECTION 3 — Loading Localization Data (4:00–5:30)

> "Here's where it gets powerful. I have a real localization CSV — 24 languages, typical for a major title release."

**Action:** Drag `source-data.csv` onto the Auto-Localize drop zone above the editor.

> "Drop it in, and TileForge loads it directly — no conversion step, no reformatting. It supports CSV, XML, and JSON arrays from the same drop zone."

> "Now look — tiles for every locale, all at once. French, German, Japanese, Arabic, Korean, Brazilian Portuguese — all rendering with the actual translated strings."

**Action:** Scroll through the tile grid.

---

## SECTION 4 — Overflow Detection (5:30–7:30)

> "This is the part that saves cert submissions. Watch what happens with German."

**Action:** Point to any German tile showing an overflow warning.

> "German titles are routinely 30 to 40 percent longer than English. TileForge measures the actual rendered text — not a character count estimate — and flags anything that would truncate or overflow in the real Xbox UI.
>
> Red badge means overflow. Yellow means it's close. Green means clean."

**Action:** Hover over a flagged tile to show the detail.

> "The analytics bar at the top gives you a summary: how many tiles are clean, how many are warning, how many are critical. One glance and you know your localization health."

---

## SECTION 5 — Live Editor (7:30–9:30)

> "Now say your German translator gives you a revised string. I don't need to re-upload anything."

**Action:** Click on the German tile.

> "The live editor opens inline. I can type the new title right here — and watch the tile update in real time."

**Action:** Type a shorter German string. Watch the overflow badge clear.

> "The editor is template-aware. If I'm on Mobile Spotlight, the character limits are 60 for title and 80 for subtitle. On Top of Home it's 40 each. The editor enforces those limits and shows you the character count live."

**Action:** Close the editor.

---

## SECTION 6 — Manage Locales + Validation (9:30–11:30)

> "Not every build ships to every region. Let's say this title is Top of Home and we need to confirm we have exactly the right locale set."

**Action:** Click the **Manage Locales** toolbar button.

> "The locale picker modal lets me filter by language, search by name, or load a preset. 'Load ToH Locales' selects the full required set — minus INVARIANT, which isn't a real player locale. 'Load Mobile Locales' includes everything."

**Action:** Click **Load ToH Locales**, then **Apply**.

> "Now see the validation badge up here next to the locale count?"

**Action:** Click the validation badge.

> "This modal tells me whether my active locale set is valid for Top of Home — correct count, no missing locales, correct order. If anything's off it shows me exactly what's missing or extra. This is the checklist that prevents cert rejections."

---

## SECTION 7 — Tools: GridPeek + String Forge (11:30–13:00)

> "Two quick tools worth knowing."

**Action:** Click the table icon in the toolbar to open GridPeek.

> "GridPeek is a fast CSV viewer. Before you load a file, you can preview the raw data — first 200 rows, all columns. Useful for catching encoding issues or verifying you have the right file."

**Action:** Close GridPeek. Open the Case Converter / String Forge panel.

> "String Forge handles text cleanup before export. UPPERCASE, lowercase, Title Case, Sentence case — one click. Strip extra spaces, remove punctuation, or append BIG IDs for loc vendor workflows. Click the output to copy. No spreadsheet needed."

---

## SECTION 8 — Export (13:00–14:00)

> "When everything looks good, you export back to Iris-compatible CSV — the exact format Xbox cert expects."

**Action:** Click Export in the toolbar.

> "The export reflects your current locale selection and any live edits you made. It's ready to hand to your cert submission pipeline.
>
> You can also export as Campsite-localized XML if your pipeline uses that format instead of CSV."

---

## WRAP-UP (14:00–15:00)

> "So in 15 minutes you've seen: template switching between ToH and Mobile Spotlight, drag-and-drop image and CSV loading, real-time overflow detection across 24-plus locales, inline live editing, locale validation against Xbox requirements, and clean export back to your pipeline.
>
> No install. No build step. Open the HTML file and go.
>
> Questions?"

---

## Demo Prep Checklist

- [ ] `sample-data/source-data.csv` downloaded/accessible
- [ ] One game tile image (JPG/PNG) ready on desktop
- [ ] `index.html` open in Chrome, fresh state (no prior data loaded)
- [ ] Browser zoom at 100%, full screen
- [ ] Kill any browser notifications that might interrupt
