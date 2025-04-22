# Nova Modular Banner System

> Version: **v1.0**  
> Style: Glassy, Themed, Dismissible  
> Location: `/css/banner.css`, `/js/banner.js`

---

## ✨ Overview

Nova's new modular banner system adds lightweight, animated alerts just below the navigation bar. These banners are glassy, blurred, and support three visual types: `info`, `warn`, and `critical`.

Designed for ambient announcements, live system alerts, or user notifications.

---

## 🎨 Banner Types & Appearance

Each banner type inherits Nova's theme colors and displays with a glowing glass aesthetic:

| Type      | Icon | Example Color         |
|-----------|------|------------------------|
| `info`    | ℹ️   | Nova dark accent (blue) |
| `warn`    | ⚠️   | Soft amber              |
| `critical`| ❌   | Glitch red              |

All banners include:
- Blurred background
- Drop shadow
- Dismiss button (×)
- Fade-in animation

---

## 🔧 How to Use

### ✅ Trigger a banner via JavaScript

```js
// Syntax
showBanner("Your message here", "type", durationInMs);

// Example
showBanner("Nova is online and stable.", "info", 6000);
showBanner("Glitch detected in memory grid.", "warn", 8000);
showBanner("Critical system failure!", "critical", 10000);
```

### 🧯 Close manually with the "×" or wait for auto-dismiss.

---

## 📁 Files

- **CSS**: `/css/banner.css`
- **JS**:  `/js/banner.js`

Make sure the following line is included in your HTML just below `<body>`:

```html
<div class="banner-container" id="banner-container"></div>
```

And load the JS in your `<script>` stack:

```html
<script src="/js/banner.js" defer></script>
```

---

## 🧠 Notes

- Banners fade in smoothly, and dismiss instantly for now.
- The close animation is optional and can be re-enabled in future versions.
- Only one banner is displayed at a time.

---

## 📦 Roadmap Ideas

- [ ] Queue multiple banners
- [ ] Persistent banner mode
- [ ] Optional sound cue or visual pulse