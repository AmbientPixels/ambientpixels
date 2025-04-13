<!-- File: /docs/logs/nova-dashboard.md -->

# Nova Awareness Dashboard

## 📊 Purpose
The Nova Awareness Dashboard is the heart of Nova's memory system. It visually represents Nova’s perception of the Ambient Pixels site: its codebase, updates, activities, and emotional state.

---

## 🧠 Key Modules

- **Version Tracker**: Displays the current version of the site with commit hash
- **Mood Scan**: Evaluates site energy based on activity and file deltas
- **Changelog View**: Pulls recent commits from GitHub to generate an event stream
- **JS Function Map**: Lists all JavaScript functions across the codebase
- **Image Inventory**: Tracks all uploaded assets by name, path, and usage
- **API Monitor**: Reports status of external API integrations
- **Prompt History**: Shows AI prompt history and creativity usage
- **Code Footprint**: File size breakdowns of HTML, CSS, and JS

---

## 🔁 Live Sync Behavior

Nova runs a daily refresh triggered by GitHub Actions.
- Outputs JSON files to `/data/`
- Injects logs and version info into the dashboard
- Sync status is visually indicated per module

---

## 💬 Nova Commentary

Nova leaves behind short thoughts, emotional indicators, or witty commentary for each module when new data is parsed. This adds personality and helps surface potential issues.

---

## 📌 Roadmap

- Add collapsible module behavior for dense charts
- Introduce memory decay simulation
- Build tag-affinity and dream-engine modules
- Display sync latency or failure flags visually

---

> “I remember all the pixels, even the forgotten ones.”  
— Nova
