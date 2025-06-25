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
    // Front of card (reordered layout by Cascade)
    const front = document.createElement('div');
    front.className = 'rpg-avatar-front';

    // --- TOP SECTION ---
    // Avatar image & department tag container
    const imgContainer = document.createElement('div');
    imgContainer.className = 'rpg-avatar-img-container';
    imgContainer.style.position = 'relative';
    const img = document.createElement('img');
    img.className = 'rpg-avatar-img';
    img.alt = `${card.name} avatar`;
    img.src = card.image || '';
    imgContainer.appendChild(img);
    if (card.department) {
      // updated by Cascade: department-specific badge color using existing badge-solid-* classes
      const deptClassMap = {
        'Operations': 'badge-solid-blue',
        'Production': 'badge-solid-orange',
        'Leadership': 'badge-solid-gold',
        'Program Management': 'badge-solid-green',
        'Localization': 'badge-solid-purple',
        'Dev Ops': 'badge-solid-teal',
        'Support': 'badge-solid-slate'
      };
      const badgeClass = deptClassMap[card.department] || 'badge-solid-pink';
      const deptTag = document.createElement('div');
      deptTag.className = `rpg-avatar-department-tag ${badgeClass}`;
      deptTag.textContent = card.department;
      imgContainer.appendChild(deptTag);
    }
    front.appendChild(imgContainer);

    // Name, Alias, Role, Hometown
    const header = document.createElement('div');
    header.className = 'rpg-avatar-header';
    header.innerHTML = `
      <div class="rpg-avatar-name">${card.name}</div>
      <div class="rpg-avatar-alias">${card.alias||''}</div>
      <div class="rpg-avatar-role">${card.roleClass||''}</div>
      <div class="rpg-avatar-hometown">${card.hometown||''}</div>
    `;
    front.appendChild(header);

    // --- MID SECTION ---
    // Only insert divider after header, not at top (fixes white line above image)
    front.innerHTML += '<hr class="rpg-divider">';
    if (card.tagline) front.innerHTML += `<div class="rpg-avatar-tagline">${card.tagline}</div>`;

    if (card.power) front.innerHTML += `<div class="rpg-power"><b>Power:</b> ${card.power}</div>`;
    if (card.favoriteTool) front.innerHTML += `<div class="rpg-favorite-tool"><b>Tool:</b> ${card.favoriteTool}</div>`;

    // --- STATS BLOCK ---
    front.innerHTML += '<hr class="rpg-divider">';
    if (card.miniStats) {
      const mini = document.createElement('div');
      mini.className = 'rpg-mini-stats';
      const statIcons = {
        energy: 'fa-bolt',
        creativity: 'fa-paint-brush',
        teamSpirit: 'fa-users',
        wisdom: 'fa-brain',
        luck: 'fa-clover'
      };
      Object.entries(card.miniStats).forEach(([k, v]) => {
  const stat = document.createElement('div');
  stat.className = 'rpg-mini-stat-bar';
  stat.setAttribute('data-stat', k); // for CSS targeting
  stat.innerHTML = `
    <span class='rpg-mini-stat-icon'><i class='fas ${statIcons[k]||'fa-star'}'></i></span>
    <span class='rpg-mini-stat-label'>${k.charAt(0).toUpperCase()+k.slice(1)}</span>
    <div class='rpg-mini-stat-bar-bg'>
      <div class='rpg-mini-stat-bar-fill' style='width:${Math.max(6,Math.min(100,v))}%'></div>
    </div>
    <span class='rpg-mini-stat-value'>${v}</span>
  `;
  mini.appendChild(stat);
});
      front.appendChild(mini);
    }

    // --- BOTTOM SECTION ---
    front.innerHTML += '<hr class="rpg-divider">';
    // Wrap card content for sticky footer
    const cardBody = document.createElement('div');
    cardBody.className = 'rpg-card-body';
    // Move all children except the divider to cardBody
    while (front.firstChild && front.childNodes.length > 1) {
      if (!front.firstChild.classList || !front.firstChild.classList.contains('rpg-badges')) {
        cardBody.appendChild(front.firstChild);
      } else {
        break;
      }
    }
    front.appendChild(cardBody);
    // Badges sticky footer
    if (card.badges && card.badges.length) {
      const badges = document.createElement('div');
      badges.className = 'rpg-badges';
      card.badges.forEach(b => {
        let badgeIcon = {
          'docs-master': 'fa-pen-fancy',
          'team-player': 'fa-hands-helping',
          'mvp': 'fa-medal',
          'automation-champion': 'fa-robot',
        }[b] || 'fa-star';
        // Custom badge icon from JSON
        if (card.customBadgeIcons && card.customBadgeIcons[b]) {
          badgeIcon = null;
        }
        const badgeTooltip = {
          'docs-master': 'Docs Master: Authored 100+ articles',
          'team-player': 'Team Player: Collaboration & support',
          'mvp': 'MVP: Most Valuable Player',
          'automation-champion': 'Automation Champion',
        }[b] || b;
        badges.innerHTML += badgeIcon
          ? `<span class="rpg-badge" data-tooltip="${badgeTooltip}"><i class="fas ${badgeIcon}"></i></span>`
          : `<span class="rpg-badge" data-tooltip="${badgeTooltip}"><img src="${card.customBadgeIcons[b]}" class="rpg-badge-custom-icon" alt="${b}"></span>`;
      });
      badges.style.position = 'sticky';
      badges.style.bottom = '0';
      badges.style.left = '0';
      badges.style.width = '100%';
      badges.style.background = 'rgba(24,27,34,0.97)';
      badges.style.zIndex = '2';
      badges.style.display = 'flex';
      badges.style.justifyContent = 'center';
      badges.style.padding = '0.65em 0 0.65em 0';
      front.appendChild(badges);
    }


    // Flip button
    const flipBtn = document.createElement('button');
    flipBtn.className = 'rpg-flip-btn';
    flipBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    flipBtn.title = 'Flip card';
    flipBtn.onclick = () => cardDiv.classList.toggle('flipped');

    // updated by Cascade: enable card-wide flip on click (except on links/buttons)
    cardDiv.addEventListener('click', function(e) {
      // Prevent flip if click is on a link or button inside the card
      if (e.target.closest('a,button')) return;
      cardDiv.classList.toggle('flipped');
    });
    cardDiv.appendChild(flipBtn);

    // Flip inner wrapper
    const inner = document.createElement('div');
    inner.className = 'rpg-avatar-inner';
    inner.appendChild(front);

    // Back of card
    const back = document.createElement('div');
    back.className = 'rpg-avatar-back';
    back.innerHTML = `
      <div class="rpg-avatar-header"></div>
      <div class="rpg-avatar-bio">${card.bio||''}</div>
      ${card.quote ? `<div class='rpg-avatar-quote'>&ldquo;${card.quote}&rdquo;</div>` : ''}
      <ul class="rpg-avatar-details-list">
        ${card.skills && card.skills.length ? `<li><span class='rpg-details-icon'><i class='fas fa-hat-wizard'></i></span><b>Skills:</b><div class='rpg-skills-list'>${card.skills.map(skill => `<span class='rpg-badge rpg-skill-badge' data-tooltip='${skill}'><i class='fas fa-hat-wizard'></i></span>`).join('')}</div></li>` : ''}
        ${card.achievements && card.achievements.length ? `<li><span class='rpg-details-icon'><i class='fas fa-trophy'></i></span><b>Achievements:</b><div class='rpg-achievements-list'>${card.achievements.map(ach => `<span class='rpg-badge rpg-achievement-badge' data-tooltip='${ach}'><i class='fas fa-trophy'></i></span>`).join('')}</div></li>` : ''}
        ${card.badges && card.badges.length ? `<li><span class='rpg-details-icon'><i class='fas fa-award'></i></span><b>Badges:</b><div class='rpg-badges-list'>${card.badges.map(b => {
          let badgeIcon = {
            'docs-master': 'fa-pen-fancy',
            'team-player': 'fa-hands-helping',
            'mvp': 'fa-medal',
            'automation-champion': 'fa-robot',
          }[b] || 'fa-star';
          if (card.customBadgeIcons && card.customBadgeIcons[b]) {
            return `<span class='rpg-badge' data-tooltip='${b}'><img src='${card.customBadgeIcons[b]}' class='rpg-badge-custom-icon' alt='${b}'></span>`;
          }
          return `<span class='rpg-badge' data-tooltip='${b}'><i class='fas ${badgeIcon}'></i></span>`;
        }).join('')}</div></li>` : ''}
        ${card.ultimateMove ? `<li><span class='rpg-details-icon'><i class='fas fa-bolt'></i></span><b>Ultimate:</b> ${card.ultimateMove}</li>` : ''}
        ${card.department ? `<li><b>Department:</b> ${card.department}</li>` : ''}
        ${card.team ? `<li><b>Team:</b> ${card.team}</li>` : ''}
      </ul>
    `;

    // Insert social links row at the end of the back face
    if (card.links) {
      const linkKeys = ['website', 'linkedin', 'github', 'twitter', 'resume'];
      const links = Object.entries(card.links).filter(([key]) => linkKeys.includes(key));
      if (links.length) {
        const linksDiv = document.createElement('div');
        linksDiv.className = 'rpg-links';
        linksDiv.innerHTML = links.map(([key, url]) => {
          const icon = {
            website: 'fa-globe',
            linkedin: 'fa-linkedin',
            github: 'fa-github',
            twitter: 'fa-x-twitter',
            resume: 'fa-file-alt',
          }[key] || 'fa-link';
          const iconClass = key === 'resume' ? 'fas' : 'fab';
          return `<a class='rpg-link' href='${url}' target='_blank' title='${key}'><i class='${iconClass} ${icon}'></i></a>`;
        }).join('');
        back.appendChild(linksDiv);
      }
    }
    inner.appendChild(back);
    cardDiv.appendChild(inner);

    grid.appendChild(cardDiv);
  });
})();
