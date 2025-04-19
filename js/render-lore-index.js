// render-lore-index.js

async function renderLoreIndex() {
    try {
      const res = await fetch("/nova/lore/index.json");
      const loreItems = await res.json();
      const listEl = document.querySelector(".lore-list");
  
      if (!listEl) return;
  
      listEl.innerHTML = loreItems
        .map(
          (item) => `
          <li>
            <a href="${item.path}">${item.icon} ${item.title}</a>
            <div class="lore-summary">${item.summary}</div>
          </li>
        `
        )
        .join("");
    } catch (e) {
      console.error("🧠 Failed to load lore index:", e);
    }
  }
  
  window.addEventListener("DOMContentLoaded", renderLoreIndex);
  