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
      const deptTag = document.createElement('div');
      deptTag.className = 'rpg-avatar-department-tag';
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
        stat.innerHTML = `
          <span class='rpg-mini-stat-icon'><i class='fas ${statIcons[k]||'fa-star'}'></i></span>
          <span class='rpg-mini-stat-label'>${k.charAt(0).toUpperCase()+k.slice(1)}</span>
          <div class='rpg-mini-stat-bar-bg'>
            <div class='rpg-mini-stat-bar-fill' style='width:${Math.min(100,v)}%'></div>
          </div>
          <span class='rpg-mini-stat-value'>${v}</span>
        `;
        mini.appendChild(stat);
      });
      front.appendChild(mini);
    }

    // --- BOTTOM SECTION ---
    front.innerHTML += '<hr class="rpg-divider">';
    // Badges (with custom icon support)
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
      front.appendChild(badges);
    }


    // Flip button
    const flipBtn = document.createElement('button');
    flipBtn.className = 'rpg-flip-btn';
    flipBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    flipBtn.title = 'Flip card';
    flipBtn.onclick = () => cardDiv.classList.toggle('flipped');
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
      ${card.skills && card.skills.length ? `<div class='rpg-avatar-skills'><b>Skills:</b> ${card.skills.join(', ')}</div>` : ''}
      ${card.achievements && card.achievements.length ? `<div class='rpg-avatar-achievements'><b>Achievements:</b> ${card.achievements.join(', ')}</div>` : ''}
      ${card.links ? (() => {
        const linkKeys = ['website', 'linkedin', 'github', 'twitter', 'resume'];
        const links = Object.entries(card.links).filter(([key]) => linkKeys.includes(key));
        if (links.length) {
          return `<div class='rpg-links'>${links.map(([key, url]) => {
            const icon = {
              website: 'fa-globe',
              linkedin: 'fa-linkedin',
              github: 'fa-github',
              twitter: 'fa-x-twitter',
              resume: 'fa-file-alt',
            }[key] || 'fa-link';
            const iconClass = key === 'resume' ? 'fas' : 'fab';
            return `<a class='rpg-link' href='${url}' target='_blank' title='${key}'><i class='${iconClass} ${icon}'></i></a>`;
          }).join('')}</div>`;
        }
        return '';
      })() : ''}
      ${card.ultimateMove ? `<div class='rpg-avatar-ultimate'><b>Ultimate:</b> ${card.ultimateMove}</div>` : ''}
      <div class="rpg-avatar-team"><b>Team:</b> ${card.team||''}</div>
    `;
    // Back footer for social links (linkedin, github, twitter, email)
    if (card.links) {
      const socialKeys = ['linkedin', 'github', 'twitter', 'email'];
      const socialLinks = Object.entries(card.links).filter(([key]) => socialKeys.includes(key));
      if (socialLinks.length) {
        const footer = document.createElement('div');
        footer.className = 'rpg-avatar-footer';
        const links = document.createElement('div');
        links.className = 'rpg-links';
        links.innerHTML = socialLinks.map(([key, url]) => {
          const icon = {
            linkedin: 'fa-linkedin', github: 'fa-github', twitter: 'fa-x-twitter', email: 'fa-envelope'
          }[key] || 'fa-link';
          // Use fab for brands, fas for envelope
          const iconClass = key === 'email' ? 'fas' : 'fab';
          return `<a class='rpg-link' href='${url}' target='_blank' title='${key}'><i class='${iconClass} ${icon}'></i></a>`;
        }).join('');
        footer.appendChild(links);
        back.appendChild(footer);
      }
    }
    inner.appendChild(back);
    cardDiv.appendChild(inner);

    grid.appendChild(cardDiv);
  });
})();
