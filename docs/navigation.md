# Navigation System Overview

_Last updated: 2025-06-29_

## Purpose
This document describes the navigation system for AmbientPixels EchoGrid, including design principles, structure, behaviors, and implementation details for both desktop and mobile navigation.

---

## 1. Navigation Structure
- The navigation is defined in `/modules/header.html`.
- Uses a horizontal bar with logo, nav links, and utility actions (theme toggle, login/profile).
- Nav links are rendered as a `<ul class="nav-links">` with each item as an icon and label.

**Example:**
```html
<ul class="nav-links">
  <li><a href="/index.html"><i class="fas fa-home"></i><span class="link-text">Home</span></a></li>
  ...
</ul>
```

---

## 2. Desktop Navigation (≥921px)
- **Default:** Compact, icon-only menu. Nav items are tightly packed.
- **On Hover/Focus:**
  - The hovered nav item smoothly expands to reveal its label ("expanding navigation" or "animated icon label reveal").
  - The label appears with a fade/slide effect using `max-width` and `opacity` transitions.
  - Other nav items shuffle over as needed—no menu-wide sliding.
- **Accessibility:** Labels are revealed on keyboard focus as well as mouse hover.
- **Implementation:**
  - All nav logic is in `/css/nav.css` under the desktop media query.
  - No JavaScript is required for the animation.

---

## 3. Mobile & Tablet Navigation (<921px)
- **Mobile (≤768px):**
  - Menu collapses into a hamburger toggle.
  - Nav links display in a grid, icons above text.
- **Tablet (769px–920px):**
  - Nav links stack vertically, icons above text.
- **No hover/focus animation** is applied on mobile/tablet.

---

## 4. Accessibility Details
- All interactive nav elements use semantic HTML (`<nav>`, `<ul>`, `<li>`, `<a>`).
- ARIA attributes (`aria-label`, `aria-expanded`) are applied to the nav toggle and profile dropdown.
- Keyboard navigation is fully supported: Tab/Shift+Tab cycles through links, Enter/Space activates toggles.
- Focus states are styled for visibility.
- Screen readers will announce nav structure and labels.

---

## 5. Customization & Theming
- Colors, spacing, and icon sets are controlled via `/css/nav.css`.
- Nova/ambient design tokens (e.g., `--aura-*`, `--mood-*`) may be used for brand consistency.
- To add a new nav item:
  1. Edit `/modules/header.html` and add a new `<li><a>...</a></li>`.
  2. Optionally update icons (FontAwesome or system set).
  3. Adjust max-width for `.link-text` if label is longer than usual.

---

## 6. Responsive Behavior & Breakpoints
- **Breakpoints:**
  - `≤768px`: Mobile (hamburger, grid nav)
  - `769px–920px`: Tablet (vertical nav)
  - `≥921px`: Desktop (expanding nav)
- All breakpoints and transitions are defined in `/css/nav.css`.
- Test responsiveness using browser dev tools or by resizing the window.

---

## 7. Known Issues & Limitations
- Expanding nav effect relies on CSS `max-width`/`opacity` transitions (requires modern browsers).
- Very long nav labels may overflow unless `max-width` is increased.
- No support for multi-level dropdowns in current nav.
- Some older browsers may not animate the effect smoothly.

---

## 8. Future Enhancements (Roadmap)
- Avatar picker modal and persistent user avatars
- Animated underline or crystalline aura effects on hover
- Additional accessibility improvements (e.g., skip-to-content link)
- Optional tooltips for nav labels on mobile
- Integration with Nova mood/telemetry system

---

## 9. Visual Examples / Screenshots
*(Add screenshots or diagrams of desktop, tablet, and mobile nav states here)*

---

## 10. Changelog
- **2025-06-29:** Desktop nav updated to use expanding navigation (animated icon label reveal) effect. Documentation created and expanded.
- **2025-06-29:** Banner login event fallback logic documented.

---

## 4. Design Principles
- **Compactness:** Icons are always tightly packed unless a nav item is actively hovered/focused.
- **Clarity:** Labels are hidden by default but always accessible on interaction.
- **Accessibility:** Keyboard navigation and focus states are fully supported.
- **Consistency:** Follows the Nova crystalline/ambient design language.

---

## 5. Implementation Notes
- All navigation styles are in `/css/nav.css`.
- Nav structure is in `/modules/header.html`.
- The expanding nav effect is a standard UI pattern for modern dashboards and apps.
- No inline styles or JavaScript are used for nav animation (per Windsurf rules).

---

## 6. References
- [project-auth-expansion.md](./project-auth-expansion.md) — for change log and historical context

---

## 7. Future Enhancements
- Avatar picker modal (pending)
- Additional nav accessibility testing
- Optional: Add tooltip for nav labels on mobile

---

For questions or contributions, see the project README or contact the maintainers.
