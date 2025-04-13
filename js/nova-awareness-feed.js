// File: /js/nova-awareness-feed.js

// Inject awareness feed logs (e.g., latest changelog commit, image change, or Nova system event)
document.addEventListener("DOMContentLoaded", () => {
    const feedList = document.getElementById("nova-awareness-feed");
    if (!feedList) return;
  
    fetch("/data/changelog.json")
      .then((res) => res.json())
      .then((data) => {
        if (!data.entries || !data.entries.length) return;
  
        feedList.innerHTML = "";
  
        data.entries.slice(0, 5).forEach((entry) => {
          const date = new Date(entry.date).toLocaleDateString();
          const li = document.createElement("li");
          li.innerHTML = `
            <div class="nova-feed-item">
              <strong>${date}</strong>
              <p>${entry.message}</p>
            </div>
          `;
          feedList.appendChild(li);
        });
      })
      .catch((err) => {
        console.warn("[Nova Awareness Feed] Failed to load changelog.", err);
        feedList.innerHTML = `<li class="nova-alert">⚠️ Awareness feed offline</li>`;
      });
  });
  