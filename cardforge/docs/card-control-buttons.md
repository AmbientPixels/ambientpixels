# CardForge Card Control Buttons

This document describes the main control buttons available for each card in the CardForge My Cards list and toolbar. Each button provides a core action for card management and editing.

## Button Reference

| Button    | Icon                | Action Description                                                                                 |
|-----------|---------------------|---------------------------------------------------------------------------------------------------|
| Save      | 💾 (fa-save)        | Saves the current card. Updates existing or adds new card to the top of the list.                 |
| Duplicate | 📄 (fa-copy)        | Creates a deep copy of the selected card, assigns a new unique ID and name, and adds to the list. |
| Publish   | 🚀 (fa-share)       | Publishes the card (implementation may vary; typically marks as published and syncs to backend).  |
| Delete    | 🗑️ (fa-trash)       | Deletes the card from local storage after confirmation.                                            |
| Edit      | ✏️ (fa-edit)        | Loads the card into the editor for modification.                                                   |

### Toolbar Buttons
- Toolbar buttons (above the editor) provide quick access to Save, Duplicate, Reset, and Clear All actions for the card currently loaded in the editor.
- If Duplicate is used from the toolbar, it will duplicate the currently selected/loaded card.

### My Cards List Buttons
- Each card in the My Cards list displays these action buttons as icons for that specific card.
- Actions are applied to the card associated with the button pressed.

## Usage Notes
- All buttons are bound to single-source-of-truth logic in `cardforge-forge-actions.js` for maintainability.
- Duplicates are named automatically to avoid confusion (e.g., "Name Copy", "Name Copy (2)").
- Delete requires confirmation to prevent accidental loss.
- Publish may require additional configuration for backend sync.

---

_Last updated: 2025-08-15 by Cascade_
