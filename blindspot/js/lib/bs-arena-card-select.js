/**
 * Arena Card Select — card picker strip and champion display
 */
window.ArenaCardSelect = (function () {
  'use strict';

  // Stat alias mapping for client-side preview (mirrors server config)
  const STAT_ALIASES = {
    str: ['strength', 'power', 'combat', 'attack', 'might'],
    agi: ['agility', 'speed', 'dexterity', 'reflexes', 'stealth', 'quickness'],
    int: ['intelligence', 'magic', 'wisdom', 'tech', 'hacking', 'intellect', 'sorcery'],
    end: ['endurance', 'defense', 'vitality', 'constitution', 'stamina', 'toughness', 'resilience'],
    lck: ['luck', 'charisma', 'fortune', 'intuition', 'charm']
  };
  const STAT_DEFAULTS = { str: 40, agi: 40, int: 40, end: 40, lck: 30 };

  function mapStats(card) {
    const combat = { ...STAT_DEFAULTS };

    // New cards: use combatStats object directly
    if (card.combatStats && typeof card.combatStats === 'object') {
      for (const key of Object.keys(combat)) {
        if (card.combatStats[key] !== undefined) {
          combat[key] = Math.min(100, Math.max(1, Math.round(card.combatStats[key])));
        }
      }
      return combat;
    }

    // Legacy fallback: alias matching
    if (!card.stats || card.stats.length === 0) return combat;

    const maxVal = Math.max(...card.stats.map(s => s.value || 0));
    const scale = maxVal <= 10 ? 10 : 1;

    for (const [key, aliases] of Object.entries(STAT_ALIASES)) {
      const match = card.stats.find(s => aliases.includes((s.name || '').toLowerCase().trim()));
      if (match) combat[key] = Math.min(100, Math.max(1, Math.round((match.value || 0) * scale)));
    }
    return combat;
  }

  function computeHp(stats) {
    return Math.round(80 + stats.end * 1.5 + stats.str * 0.3);
  }

  function renderCardStrip(cards, containerId, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!cards || cards.length === 0) {
      container.innerHTML = '<div class="arena-empty-state">No cards found. Create one in the Forge first!</div>';
      return;
    }

    cards.forEach(card => {
      const el = document.createElement('button');
      el.className = 'arena-card-thumb';
      el.dataset.cardId = card.id;
      el.innerHTML = `
        <div class="arena-card-thumb__avatar">
          ${card.avatar ? `<img src="${card.avatar}" alt="${card.name || 'Card'}">` : '<i class="fas fa-user"></i>'}
        </div>
        <div class="arena-card-thumb__name">${card.name || 'Unnamed'}</div>
        <div class="arena-card-thumb__class">${card.class || ''}</div>
      `;
      el.addEventListener('click', () => onSelect(card));
      container.appendChild(el);
    });
  }

  function renderChampionDisplay(card, containerId, profile) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!card) {
      container.innerHTML = `
        <div class="arena-champion__empty">
          <i class="fas fa-plus-circle"></i>
          <p>Select a card from your collection to fight with</p>
        </div>
      `;
      return;
    }

    const stats = mapStats(card);
    const hp = computeHp(stats);
    const hasNoStats = !card.stats || card.stats.length === 0;

    // Build record line from profile
    let recordHTML = '';
    if (profile && profile.record) {
      const rank = (profile.rank || 'unranked').charAt(0).toUpperCase() + (profile.rank || 'unranked').slice(1);
      const w = profile.record.wins || 0;
      const l = profile.record.losses || 0;
      const lvl = profile.level || 1;
      recordHTML = `
        <div class="arena-champion__record">
          <span class="arena-champion__rank-pill arena-champion__rank-pill--${(profile.rank || 'bronze').toLowerCase()}">${rank}</span>
          <span>Lv.${lvl}</span>
          <span>${w}W / ${l}L</span>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="arena-champion__card">
        <div class="arena-champion__avatar">
          ${card.avatar ? `<img src="${card.avatar}" alt="${card.name}">` : '<i class="fas fa-user-shield"></i>'}
        </div>
        <div class="arena-champion__info">
          <div class="arena-champion__name">${card.name || 'Unnamed'}</div>
          <div class="arena-champion__class">${card.class || 'Unknown Class'}</div>
          ${card.quote ? `<div class="arena-champion__quote">"${card.quote}"</div>` : ''}
          <div class="arena-champion__stats">
            <span title="Strength"><i class="fas fa-hand-fist"></i> STR ${stats.str}</span>
            <span title="Agility"><i class="fas fa-feather-pointed"></i> AGI ${stats.agi}</span>
            <span title="Intelligence"><i class="fas fa-bolt"></i> INT ${stats.int}</span>
            <span title="Endurance"><i class="fas fa-heart"></i> END ${stats.end}</span>
            <span title="Luck"><i class="fas fa-clover"></i> LCK ${stats.lck}</span>
            <span title="HP" class="arena-champion__hp"><i class="fas fa-heart-pulse"></i> HP ${hp}</span>
          </div>
          ${recordHTML}
          ${hasNoStats ? '<div class="arena-champion__nudge"><i class="fas fa-info-circle"></i> Add stats in the editor for a combat advantage!</div>' : ''}
        </div>
      </div>
    `;
  }

  // Highlight selected card in strip
  function highlightCard(containerId, cardId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.arena-card-thumb').forEach(el => {
      el.classList.toggle('arena-card-thumb--selected', el.dataset.cardId === cardId);
    });
  }

  return { renderCardStrip, renderChampionDisplay, highlightCard, mapStats, computeHp };
})();
