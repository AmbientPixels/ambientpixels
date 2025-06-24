// RPG Avatar Card System | Modular

(async function initRPGCards() {
  // Load JSON data
  const res = await fetch('/modules/rpg-avatar-cards.json');
  const data = await res.json();
  const grid = document.querySelector('.rpg-avatar-grid');
  if (!grid) return;

  // Check for layout property (top-level object in array)
  let layout = 3;
  if (Array.isArray(data) && typeof data[0] === 'object' && 'layout' in data[0]) {
    const val = parseInt(data[0].layout, 10);
    if (val >= 1 && val <= 6) layout = val;
  }
  grid.classList.add(`rpg-grid-cols-${layout}`);

  // Render each card
  // If layout property exists as first element, skip it for cards
  const cards = (Array.isArray(data) && typeof data[0] === 'object' && 'layout' in data[0]) ? data.slice(1) : data;
  cards.filter(card => card.active).sort((a, b) => (a.order||0)-(b.order||0)).forEach(card => {
    // Card container
    const cardDiv = document.createElement('div');
    cardDiv.className = 'rpg-avatar-card';
    if (card.theme) cardDiv.setAttribute('data-theme', card.theme);
    // Front of card
    const front = document.createElement('div');
    front.className = 'rpg-avatar-front';
    // Avatar image (from JSON)
    const img = document.createElement('img');
    img.className = 'rpg-avatar-img';
    img.alt = `${card.name} avatar`;
    img.src = card.image || '';
    front.appendChild(img);

    // Header
    const header = document.createElement('div');
    header.className = 'rpg-avatar-header';
    header.innerHTML = `
      <div class="rpg-avatar-name">${card.name}</div>
      <div class="rpg-avatar-alias">${card.alias||''}</div>
      <div class="rpg-avatar-role">${card.roleClass||''}</div>
      <div class="rpg-avatar-hometown">${card.hometown||''}</div>
      <div class="rpg-avatar-tagline">${card.tagline||''}</div>
    `;
    front.appendChild(header);
    // Mini stats
    if (card.miniStats) {
      const mini = document.createElement('div');
      mini.className = 'rpg-mini-stats';
      Object.entries(card.miniStats).forEach(([k, v]) => {
        const stat = document.createElement('div');
        stat.className = 'rpg-mini-stat';
        stat.innerHTML = `<span>${k.charAt(0).toUpperCase()+k.slice(1)}:</span> <b>${v}</b>`;
        mini.appendChild(stat);
      });
      front.appendChild(mini);
    }
    // Power & tool
    if (card.power) front.innerHTML += `<div class="rpg-power">Power: ${card.power}</div>`;
    if (card.favoriteTool) front.innerHTML += `<div class="rpg-favorite-tool">Tool: ${card.favoriteTool}</div>`;
    // Links
    if (card.links) {
      const links = document.createElement('div');
      links.className = 'rpg-links';
      for (const [key, url] of Object.entries(card.links)) {
        const icon = {
          website: 'fa-globe', linkedin: 'fa-linkedin', github: 'fa-github', resume: 'fa-file-alt', twitter: 'fa-x-twitter', email: 'fa-envelope'
        }[key] || 'fa-link';
        links.innerHTML += `<a class="rpg-link" href="${url}" target="_blank" title="${key}"><i class="fab ${icon}"></i></a>`;
      }
      front.appendChild(links);
    }
    // Badges
    if (card.badges && card.badges.length) {
      const badges = document.createElement('div');
      badges.className = 'rpg-badges';
      card.badges.forEach(b => {
        const badgeIcon = {
          'docs-master': 'fa-pen-fancy',
          'team-player': 'fa-hands-helping',
          'mvp': 'fa-medal',
          'automation-champion': 'fa-robot',
        }[b] || 'fa-star';
        const badgeTooltip = {
          'docs-master': 'Docs Master: Authored 100+ articles',
          'team-player': 'Team Player: Collaboration & support',
          'mvp': 'MVP: Most Valuable Player',
          'automation-champion': 'Automation Champion',
        }[b] || b;
        badges.innerHTML += `<span class="rpg-badge" data-tooltip="${badgeTooltip}"><i class="fas ${badgeIcon}"></i></span>`;
      });
      front.appendChild(badges);
    }
    // Flip button
    const flipBtn = document.createElement('button');
    flipBtn.className = 'rpg-flip-btn';
    flipBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    flipBtn.title = 'Flip card';
    flipBtn.onclick = () => cardDiv.classList.toggle('flipped');
    cardDiv.appendChild(flipBtn);
    cardDiv.appendChild(front);

    // Back of card
    const back = document.createElement('div');
    back.className = 'rpg-avatar-back';
    back.innerHTML = `
      <div class="rpg-avatar-header">
        <div class="rpg-avatar-name">${card.name}</div>
        <div class="rpg-avatar-alias">${card.alias||''}</div>
        <div class="rpg-avatar-role">${card.roleClass||''}</div>
      </div>
      <div class="rpg-avatar-bio">${card.bio||''}</div>
      <div class="rpg-avatar-skills"><b>Skills:</b> ${card.skills ? card.skills.join(', ') : ''}</div>
      <div class="rpg-avatar-ultimate"><b>Ultimate:</b> ${card.ultimateMove||''}</div>
      <div class="rpg-avatar-team"><b>Team:</b> ${card.team||''}</div>
      <div class="rpg-avatar-achievements"><b>Achievements:</b> ${card.achievements ? card.achievements.join(', ') : ''}</div>
    `;
    cardDiv.appendChild(back);

    grid.appendChild(cardDiv);
  });
})();
