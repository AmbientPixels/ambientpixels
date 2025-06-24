// Avatar Trading Card JS (Nova style)
// Loads data, injects cards, handles flip and stat animation
fetch('/data/avatar-trading-card.json')
  .then(res => res.json())
  .then(team => {
    const container = document.getElementById('avatar-trading-card-container');
    if (!container) return;
    const template = document.getElementById('avatar-trading-card-template');
    team.forEach(member => {
      const clone = template.content.cloneNode(true);
      // Fill avatar, name, role, bio, card art
      // Card art image (rectangular, unmasked)
      const artImg = clone.querySelector('.avatar-art-img');
      if (artImg) {
        artImg.src = member.avatar;
        artImg.alt = member.name + "'s artwork";
      }
      // Inject tags into art box
      const tagsDiv = clone.querySelector('.avatar-art-tags');
      if (tagsDiv && Array.isArray(member.tags)) {
        tagsDiv.innerHTML = '';
        member.tags.forEach(tag => {
          const tagClass = 'tag-' + tag.toLowerCase().replace(/\s+/g, '-');
          const tagEl = document.createElement('span');
          tagEl.className = 'avatar-art-tag ' + tagClass;
          tagEl.textContent = tag;
          tagsDiv.appendChild(tagEl);
        });
      }
      // Inject stat bars into main card area
      const frontStatsDiv = clone.querySelector('.avatar-stats');
      if (frontStatsDiv && Array.isArray(member.stats)) {
        frontStatsDiv.innerHTML = '';
        member.stats.forEach(stat => {
          const statBar = document.createElement('div');
          statBar.className = 'avatar-stat-bar';
          statBar.innerHTML = `<i class='${stat.icon}' aria-hidden='true'></i> <span class='stat-label'>${stat.label}</span> <div class='stat-bar-bg'><div class='stat-bar-fill' style='width:${stat.value}%'></div></div> <span class='stat-value'>${stat.value}</span>`;
          frontStatsDiv.appendChild(statBar);
        });
      }
      // Inject links into footer
      const frontLinksDiv = clone.querySelector('.avatar-microstats-bar .avatar-links');
      if (frontLinksDiv && Array.isArray(member.links)) {
        frontLinksDiv.innerHTML = '';
        member.links.forEach(link => {
          const a = document.createElement('a');
          a.href = link.url;
          a.className = 'avatar-link';
          a.title = link.label;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.innerHTML = `<i class='${link.icon}' aria-hidden='true'></i>`;
          frontLinksDiv.appendChild(a);
        });
      }
      const nameEl = clone.querySelector('.avatar-name');
      if (nameEl) nameEl.textContent = member.name;
      const roleEl = clone.querySelector('.avatar-role');
      if (roleEl) roleEl.textContent = member.role;
      // Inject superpower
      const superpowerEl = clone.querySelector('.avatar-superpower');
      if (superpowerEl && member.superpower) {
        superpowerEl.textContent = member.superpower;
      }
      const bioEl = clone.querySelector('.avatar-bio');
      if (bioEl) bioEl.textContent = member.bio;
      // updated by Cascade 2025-06-23: inject quote and backMicrostats
      const quoteEl = clone.querySelector('.avatar-quote');
      if (quoteEl && member.quote) quoteEl.textContent = `“${member.quote}”`;
      const backMicrostatsEl = clone.querySelector('.avatar-back-microstats');
      if (backMicrostatsEl && Array.isArray(member.backMicrostats)) {
        backMicrostatsEl.innerHTML = '';
        member.backMicrostats.forEach(stat => {
          backMicrostatsEl.innerHTML += `<span class='avatar-microstat' title='${stat.label}'><i class='${stat.icon}' aria-hidden='true'></i> <span>${stat.value}</span></span>`;
        });
      }
      // Stats
      const statsDiv = clone.querySelector('.avatar-stats');
      statsDiv.innerHTML = '';
      member.stats.forEach(stat => {
        statsDiv.innerHTML += `<div class='stat-bar'><span class='stat-icon'><i class='${stat.icon}'></i></span><span class='stat-label'>${stat.label}</span><span class='stat-value'><span class='stat-value-fill' style='width:0%' data-value='${stat.value}'></span></span></div>`;
      });
      // Links
      const linksDiv = clone.querySelector('.avatar-links');
      linksDiv.innerHTML = '';
      member.links.forEach(link => {
        linksDiv.innerHTML += `<a class='avatar-link' href='${link.url}' target='_blank' rel='noopener' aria-label='${link.label}'><i class='${link.icon}'></i></a>`;
      });
      // Card flip logic
      const card = clone.querySelector('.avatar-card-inner');
      let flipped = false;
      card.addEventListener('click', () => {
        card.parentElement.classList.toggle('flipped');
        flipped = !flipped;
        if (flipped) animateStats(card);
      });
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          card.parentElement.classList.toggle('flipped');
          flipped = !flipped;
          if (flipped) animateStats(card);
        }
      });
      container.appendChild(clone);
    });
    // Animate stat bars on flip
    function animateStats(card) {
      card.querySelectorAll('.stat-value-fill').forEach(bar => {
        bar.style.width = bar.getAttribute('data-value') + '%';
      });
    }
  });
