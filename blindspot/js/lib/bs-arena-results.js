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
    // Show as modal overlay on top of battle screen
    var overlay = document.getElementById('arena-results-overlay');
    if (overlay) overlay.style.display = 'flex';

    const isWin = battleResult.winner === 'player';
    const isDraw = battleResult.winner === 'draw';

    // Product analytics: battle end
    try {
      if (window.ProductAnalytics) {
        var _bt = battleData.type || (battleData.battleId && battleData.battleId.indexOf('bs-async-') === 0 ? 'pvp' : 'pve');
        ProductAnalytics.track('battle_end', {
          type: _bt,
          result: isWin ? 'win' : isDraw ? 'draw' : 'loss',
          opponent: battleData.opponent ? battleData.opponent.name : '',
          rounds: battleResult.rounds || 0
        });
        if (isWin && _bt === 'pve' && battleData.opponent) {
          ProductAnalytics.trackFunnel('boss_defeated', { boss: battleData.opponent.name });
        }
      }
    } catch (_) { /* silent */ }

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

    // Avatars
    const avatarContainer = document.getElementById('arena-results-avatars');
    if (avatarContainer) {
      avatarContainer.innerHTML = '';
      if (isDraw) {
        // Show both avatars with VS between them
        const playerImg = document.createElement('img');
        playerImg.src = battleData.player.avatar || '';
        playerImg.alt = battleData.player.name;
        const vsLabel = document.createElement('span');
        vsLabel.className = 'arena-results__vs';
        vsLabel.textContent = 'VS';
        const oppImg = document.createElement('img');
        oppImg.src = battleData.opponent.avatar || '';
        oppImg.alt = battleData.opponent.name;
        avatarContainer.append(playerImg, vsLabel, oppImg);
      } else {
        // Win: show defeated boss; Loss: show your fallen card
        const img = document.createElement('img');
        img.src = (isWin ? battleData.opponent.avatar : battleData.player.avatar) || '';
        img.alt = isWin ? battleData.opponent.name : battleData.player.name;
        avatarContainer.appendChild(img);
      }
    }

    // XP section — hide in demo mode
    const xpSection = document.getElementById('arena-results-xp-section');
    if (xpSection) {
      xpSection.style.display = battleResult.isDemo ? 'none' : '';
    }

    // XP
    const xpEl = document.getElementById('arena-results-xp');
    if (xpEl) xpEl.textContent = `+${battleResult.xpEarned} XP`;

    // Rank label (current → next)
    const rank = battleResult.newRank;
    const rankDef = RANKS[rank];
    const rankIdx = RANK_ORDER.indexOf(rank);
    const nextRankKey = rankIdx < RANK_ORDER.length - 1 ? RANK_ORDER[rankIdx + 1] : null;
    const nextRankDef = nextRankKey ? RANKS[nextRankKey] : null;

    const currentEl = document.getElementById('arena-results-rank-current');
    const nextEl = document.getElementById('arena-results-rank-next');
    const rankLabel = document.getElementById('arena-results-rank-label');

    if (currentEl && rankDef) {
      currentEl.innerHTML = `<i class="fas ${rankDef.icon}" style="color:${rankDef.color}"></i> ${rankDef.label}`;
    }
    if (nextEl && nextRankDef) {
      nextEl.innerHTML = `<i class="fas ${nextRankDef.icon}" style="color:${nextRankDef.color}"></i> ${nextRankDef.label}`;
      nextEl.style.display = '';
    } else if (nextEl) {
      nextEl.style.display = 'none';
    }
    // Hide arrow if max rank
    const arrowEl = rankLabel?.querySelector('.arena-results__rank-arrow');
    if (arrowEl) arrowEl.style.display = nextRankDef ? '' : 'none';

    // XP bar
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

    // Async PvP: show Elo change + Sparks earned
    if (battleResult.isAsyncPvP) {
      var asyncInfoEl = document.getElementById('arena-results-async-pvp');
      if (!asyncInfoEl) {
        asyncInfoEl = document.createElement('div');
        asyncInfoEl.id = 'arena-results-async-pvp';
        asyncInfoEl.style.cssText = 'text-align:center;padding:0.5rem 0;font-size:0.9rem;';
        var xpSectionEl = document.getElementById('arena-results-xp-section');
        if (xpSectionEl) xpSectionEl.parentNode.insertBefore(asyncInfoEl, xpSectionEl.nextSibling);
      }
      var eloColor = battleResult.eloChange >= 0 ? 'var(--bs-success, #4ade80)' : 'var(--bs-danger, #ff5252)';
      asyncInfoEl.innerHTML =
        '<div style="display:flex;justify-content:center;gap:1.5rem;flex-wrap:wrap;">' +
          '<span style="color:' + eloColor + ';font-weight:600;">' +
            '<i class="fas fa-chart-line"></i> ' + (battleResult.eloChange >= 0 ? '+' : '') + battleResult.eloChange + ' Elo' +
          '</span>' +
          '<span style="color:var(--bs-accent, #00e5ff);font-weight:600;">' +
            '<i class="fas fa-bolt"></i> +' + (battleResult.sparksEarned || 0) + ' Sparks' +
          '</span>' +
          (battleResult.isRevenge ? '<span style="color:var(--bs-danger, #ff5252);"><i class="fas fa-fire"></i> Revenge!</span>' : '') +
        '</div>';
      asyncInfoEl.style.display = '';

      // Update Blindspot Elo in BsPvp module
      if (window.BsPvp) {
        window.BsPvp.setPvPElo(battleResult.newElo);
        window.BsPvp.setPvPRecord(battleResult.pvpRecord);
        window.BsPvp.showEloChange(
          (battleResult.eloChange >= 0 ? '+' : '') + battleResult.eloChange,
          eloColor
        );
      }
      // Update Blindspot sparks
      if (window.BsState && window.BsState.progress) {
        window.BsState.progress.sparks = (window.BsState.progress.sparks || 0) + (battleResult.sparksEarned || 0);
        window.BsState.progress.pvpElo = battleResult.newElo;
        window.BsState.progress.pvpRecord = battleResult.pvpRecord;
        window.BsState.sync();
      }
    } else {
      var oldAsyncEl = document.getElementById('arena-results-async-pvp');
      if (oldAsyncEl) oldAsyncEl.style.display = 'none';
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
    if (wins) wins.textContent = profile.record?.wins || 0;
    if (losses) losses.textContent = profile.record?.losses || 0;
    if (level) level.textContent = profile.level || 1;
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
