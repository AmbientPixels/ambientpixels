/**
 * Arena Results — results screen + match history rendering
 */
window.ArenaResults = (function () {
  'use strict';

  // Rank config (mirrors server)
  const RANKS = {
    bronze:   { xpRequired: 0,    icon: 'fa-shield-halved', color: '#CD7F32', label: 'Bronze' },
    silver:   { xpRequired: 500,  icon: 'fa-shield',        color: '#C0C0C0', label: 'Silver' },
    gold:     { xpRequired: 1500, icon: 'fa-crown',         color: '#FFD700', label: 'Gold' },
    platinum: { xpRequired: 3500, icon: 'fa-gem',           color: '#E5E4E2', label: 'Platinum' },
    diamond:  { xpRequired: 7000, icon: 'fa-diamond',       color: '#B9F2FF', label: 'Diamond' }
  };
  const RANK_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

  function getNextRankXp(currentRank) {
    const idx = RANK_ORDER.indexOf(currentRank);
    if (idx < 0 || idx >= RANK_ORDER.length - 1) return null;
    return RANKS[RANK_ORDER[idx + 1]].xpRequired;
  }

  function getCurrentRankXp(rank) {
    return RANKS[rank]?.xpRequired || 0;
  }

  function showResults(battleResult, battleData) {
    window.ArenaApp.showScreen('results');

    const isWin = battleResult.winner === 'player';
    const isDraw = battleResult.winner === 'draw';

    // Banner
    const title = document.getElementById('arena-results-title');
    const subtitle = document.getElementById('arena-results-subtitle');
    const banner = document.getElementById('arena-results-banner');

    if (title) title.textContent = isWin ? 'Victory!' : isDraw ? 'Draw!' : 'Defeat';
    if (subtitle) subtitle.textContent = isWin
      ? `You defeated ${battleData.opponent.name}`
      : isDraw ? 'The battle ended in a draw' : `${battleData.opponent.name} defeated you`;
    if (banner) {
      banner.className = 'arena-results__banner arena-results__banner--' + (isWin ? 'win' : isDraw ? 'draw' : 'loss');
    }

    // XP
    const xpEl = document.getElementById('arena-results-xp');
    if (xpEl) xpEl.textContent = `+${battleResult.xpEarned} XP`;

    // XP bar
    const rank = battleResult.newRank;
    const rankXp = getCurrentRankXp(rank);
    const nextXp = getNextRankXp(rank);
    const progressXp = battleResult.newXp - rankXp;
    const totalNeeded = nextXp ? nextXp - rankXp : 1;
    const pct = nextXp ? Math.min(100, (progressXp / totalNeeded) * 100) : 100;

    const fillEl = document.getElementById('arena-results-xp-fill');
    const textEl = document.getElementById('arena-results-xp-text');
    if (fillEl) fillEl.style.width = pct + '%';
    if (textEl) textEl.textContent = nextXp
      ? `${battleResult.newXp} / ${nextXp} XP`
      : `${battleResult.newXp} XP (Max Rank)`;

    // Rank up
    const rankUpEl = document.getElementById('arena-results-rank-up');
    const newRankEl = document.getElementById('arena-results-new-rank');
    if (rankUpEl) rankUpEl.style.display = battleResult.rankUp ? 'block' : 'none';
    if (newRankEl && battleResult.rankUp) {
      newRankEl.textContent = RANKS[battleResult.newRank]?.label || battleResult.newRank;
    }

    // Update global state
    if (window._arenaState) {
      window._arenaState.profile.xp = battleResult.newXp;
      window._arenaState.profile.rank = battleResult.newRank;
      window._arenaState.profile.level = battleResult.newLevel;
      window._arenaState.profile.record = battleResult.record;
    }

    // Refresh effect tier locks so newly earned effects unlock immediately
    if (window.CardForge && window.CardForge.applyEffectLockState) {
      window.CardForge.applyEffectLockState();
    }

    // "New Unlocks!" toast on rank-up
    if (battleResult.rankUp && window.EffectTiers && window.EffectTiers.getNewUnlocksForRank) {
      var unlocks = window.EffectTiers.getNewUnlocksForRank(battleResult.newRank);
      if (Object.keys(unlocks).length > 0) {
        showUnlockToast(battleResult.newRank, unlocks);
      }
    }
  }

  function renderMatchList(matches, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!matches || matches.length === 0) {
      container.innerHTML = '<div class="arena-empty-state">No matches yet. Choose a mode to start fighting!</div>';
      return;
    }

    container.innerHTML = matches.map(m => {
      const icon = m.result === 'win' ? 'fa-trophy' : m.result === 'loss' ? 'fa-skull' : 'fa-handshake';
      const cls = `arena-match-item arena-match-item--${m.result}`;
      const timeAgo = formatTimeAgo(m.timestamp);

      return `
        <div class="${cls}">
          <div class="arena-match-item__icon"><i class="fas ${icon}"></i></div>
          <div class="arena-match-item__info">
            <span class="arena-match-item__result">${m.result === 'win' ? 'Win' : m.result === 'loss' ? 'Loss' : 'Draw'}</span>
            vs <strong>${m.opponentName || 'Unknown'}</strong>
            <span class="arena-match-item__type">(${m.type === 'pve' ? 'PvE' : 'PvP'})</span>
          </div>
          <div class="arena-match-item__meta">
            <span class="arena-match-item__xp">+${m.xpEarned} XP</span>
            <span class="arena-match-item__time">${timeAgo}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function updateRankDisplay(profile) {
    const rank = profile.rank || 'bronze';
    const rankDef = RANKS[rank] || RANKS.bronze;

    // Top bar badge
    const badge = document.getElementById('arena-rank-badge');
    if (badge) {
      badge.innerHTML = `<i class="fas ${rankDef.icon}" style="color:${rankDef.color}"></i>`;
      badge.title = rankDef.label;
    }

    // Record
    const record = document.getElementById('arena-record');
    if (record) record.textContent = `${profile.record?.wins || 0}W / ${profile.record?.losses || 0}L`;

    // Large rank badge
    const badgeLg = document.getElementById('arena-rank-badge-lg');
    if (badgeLg) {
      badgeLg.innerHTML = `<i class="fas ${rankDef.icon}" style="color:${rankDef.color}"></i>`;
    }
    const labelEl = document.getElementById('arena-rank-label');
    if (labelEl) labelEl.textContent = rankDef.label;

    // XP bar
    const rankXp = getCurrentRankXp(rank);
    const nextXp = getNextRankXp(rank);
    const progressXp = (profile.xp || 0) - rankXp;
    const totalNeeded = nextXp ? nextXp - rankXp : 1;
    const pct = nextXp ? Math.min(100, (progressXp / totalNeeded) * 100) : 100;

    const fill = document.getElementById('arena-xp-fill');
    const text = document.getElementById('arena-xp-text');
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = nextXp ? `${profile.xp || 0} / ${nextXp} XP` : `${profile.xp || 0} XP (Max Rank)`;

    // Stats
    const wins = document.getElementById('arena-stat-wins');
    const losses = document.getElementById('arena-stat-losses');
    const level = document.getElementById('arena-stat-level');
    if (wins) wins.textContent = `${profile.record?.wins || 0} Wins`;
    if (losses) losses.textContent = `${profile.record?.losses || 0} Losses`;
    if (level) level.textContent = `Level ${profile.level || 1}`;
  }

  function showUnlockToast(rank, unlocksByCategory) {
    var rankDef = RANKS[rank] || RANKS.bronze;

    var listHtml = '';
    for (var cat in unlocksByCategory) {
      if (!unlocksByCategory.hasOwnProperty(cat)) continue;
      listHtml += '<div class="arena-unlock-toast__category">' +
        '<span class="arena-unlock-toast__cat-name">' + cat + ':</span> ' +
        unlocksByCategory[cat].join(', ') +
      '</div>';
    }

    var toast = document.createElement('div');
    toast.className = 'arena-unlock-toast';
    toast.innerHTML =
      '<div class="arena-unlock-toast__header">' +
        '<i class="fas ' + rankDef.icon + '" style="color:' + rankDef.color + '"></i>' +
        ' New Unlocks!' +
      '</div>' +
      '<div class="arena-unlock-toast__body">' + listHtml + '</div>';

    document.body.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('arena-unlock-toast--removing');
      toast.addEventListener('animationend', function () {
        if (toast.parentNode) toast.remove();
      }, { once: true });
    }, 5000);
  }

  return { showResults, renderMatchList, updateRankDisplay, RANKS, RANK_ORDER };
})();
