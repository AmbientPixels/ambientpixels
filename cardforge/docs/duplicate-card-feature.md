# CardForge Duplicate Card Feature

## Overview
CardForge now supports card duplication from both the My Cards list and the toolbar. The duplication logic is centralized for maintainability and follows Windsurf Protocol rules for code reuse and precision.

## How Duplication Works
- **From My Cards List:** Click the Duplicate button (copy icon) beside any card. The card will be deep-cloned, given a new unique ID, and its name will be updated (e.g., "Name Copy", "Name Copy (2)"). The duplicate appears at the top of the list.
- **From Toolbar:** If the toolbar Duplicate button is clicked, it duplicates the currently selected card in the UI. If no card is selected, a notification prompts the user to select one.

## Technical Details
- All duplication logic is in `CardForgeActions.prototype.duplicateCard(cardId)`.
- The toolbar and list both call this single source of truth.
- Duplicates are deep clones, preserving all card data and updating only ID, name, and lastModified.
- Notifications and list refreshes are handled automatically.

## Traceability
- All new/updated code is marked with `// updated by Cascade` for audit.

## User Experience
- No duplicate code paths; all duplication uses the same logic.
- Consistent behavior and error handling across UI entry points.

---

_Last updated: 2025-08-15 by Cascade_
