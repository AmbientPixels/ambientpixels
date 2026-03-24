/**
 * Blindspot Rewards — Challenges, Daily Bounties, Loot
 *
 * Manages challenge tracking (8 persistent milestones x 3 tiers),
 * daily bounties (3 random tasks per day), and their UI rendering.
 * Reward granting (stat changes, card saves) delegated via callbacks.
 *
 * API: window.BsRewards
 */
window.BsRewards = (function () {
  'use strict';

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function safeLSSet(k, v) { if (window.BsState && window.BsState.safeLSSet) window.BsState.safeLSSet(k, v); else { try { localStorage.setItem(k, v); } catch(e) { /* ignore */ } } }
  function progress() { return window.BsState ? window.BsState.progress : {}; }
  function sync() { if (window.BsState) window.BsState.sync(); }

  var _callbacks = {};

  // ── Challenge Definitions ──

  var CHALLENGES = [
    { id: 'wins', name: 'Warrior', icon: 'fa-sword',
      desc: ['Win 10 fights', 'Win 25 fights', 'Win 50 fights'],
      target: [10, 25, 50],
      reward: [
        { stat: 'str', amount: 3, label: '+3 STR' },
        { stat: 'str', amount: 5, label: '+5 STR' },
        { forgeWins: 2, label: '+2 Forge Wins' }
      ]
    },
    { id: 'bosses', name: 'Slayer', icon: 'fa-dragon',
      desc: ['Defeat 3 bosses', 'Defeat 7 bosses', 'Defeat all 10 bosses'],
      target: [3, 7, 10],
      reward: [
        { stat: 'end', amount: 3, label: '+3 END' },
        { stat: 'end', amount: 5, label: '+5 END' },
        { forgeWins: 3, label: '+3 Forge Wins' }
      ]
    },
    { id: 'streak', name: 'Unstoppable', icon: 'fa-fire-flame-curved',
      desc: ['Get a 3 win streak', 'Get a 5 win streak', 'Get a 10 win streak'],
      target: [3, 5, 10],
      reward: [
        { stat: 'agi', amount: 3, label: '+3 AGI' },
        { stat: 'agi', amount: 5, label: '+5 AGI' },
        { stat: 'lck', amount: 8, label: '+8 LCK' }
      ]
    },
    { id: 'forge', name: 'Artisan', icon: 'fa-fire',
      desc: ['Visit the Forge 3 times', 'Visit the Forge 5 times', 'Visit the Forge 10 times'],
      target: [3, 5, 10],
      reward: [
        { stat: 'int', amount: 3, label: '+3 INT' },
        { forgeWins: 1, label: '+1 Forge Win' },
        { stat: 'int', amount: 8, label: '+8 INT' }
      ]
    },
    { id: 'ascension', name: 'Transcendent', icon: 'fa-star',
      desc: ['Reach Ascension 1', 'Reach Ascension 3', 'Reach Ascension 5'],
      target: [1, 3, 5],
      reward: [
        { stat: 'lck', amount: 5, label: '+5 LCK' },
        { forgeWins: 3, label: '+3 Forge Wins' },
        { stat: 'str', amount: 10, label: '+10 STR' }
      ]
    },
    { id: 'pvp', name: 'Gladiator', icon: 'fa-users',
      desc: ['Win 3 PvP fights', 'Win 10 PvP fights', 'Reach Gold PvP rank'],
      target: [3, 10, 'gold'],
      reward: [
        { stat: 'agi', amount: 3, label: '+3 AGI' },
        { stat: 'str', amount: 5, label: '+5 STR' },
        { forgeWins: 3, label: '+3 Forge Wins' }
      ]
    },
    { id: 'bounties', name: 'Completionist', icon: 'fa-scroll',
      desc: ['Complete 3 daily bounties', 'Complete 10 daily bounties', 'Complete 25 daily bounties'],
      target: [3, 10, 25],
      reward: [
        { stat: 'end', amount: 3, label: '+3 END' },
        { stat: 'lck', amount: 5, label: '+5 LCK' },
        { forgeWins: 2, label: '+2 Forge Wins' }
      ]
    },
    { id: 'power', name: 'Powerhouse', icon: 'fa-bolt',
      desc: ['Reach 200 Power', 'Reach 300 Power', 'Reach 400 Power'],
      target: [200, 300, 400],
      reward: [
        { stat: 'end', amount: 3, label: '+3 END' },
        { stat: 'int', amount: 5, label: '+5 INT' },
        { stat: 'str', amount: 8, label: '+8 STR' }
      ]
    }
  ];

  // ── Bounty Pool ──

  var BOUNTY_POOL = [
    { id: 'win_3_streak', text: 'Win 3 fights in a row', check: 'streak3', reward: { xp: 25, stat: 'str', amount: 3, label: '+25 XP, +3 STR' } },
    { id: 'beat_new_boss', text: 'Defeat a new boss', check: 'newBoss', reward: { xp: 50, label: '+50 XP' } },
    { id: 'play_3', text: 'Play 3 fights today', check: 'play3', reward: { xp: 15, forgePoints: 1, label: '+15 XP, +1 Forge' } },
    { id: 'win_2', text: 'Win 2 fights today', check: 'win2', reward: { xp: 20, stat: 'agi', amount: 2, label: '+20 XP, +2 AGI' } },
    { id: 'forge_card', text: 'Visit the Forge', check: 'forgeVisit', reward: { xp: 10, label: '+10 XP' } }
  ];

  // ── Challenge Data Access ──

  function getChallengeProgress() { return progress().challenges || {}; }
  function saveChallengeProgress(data) { progress().challenges = data; }
  function getChallengeClaimedTier(chId) { return (getChallengeProgress())[chId] || 0; }

  function getChallengeCurrentValue(ch) {
    var cb = _callbacks;
    switch (ch.id) {
      case 'wins': return progress().totalWins || 0;
      case 'bosses': return cb.getHighestBoss ? cb.getHighestBoss() : 0;
      case 'streak': return cb.getBestStreak ? cb.getBestStreak() : 0;
      case 'forge': return cb.getForgeVisits ? cb.getForgeVisits() : 0;
      case 'ascension': return cb.getAscension ? cb.getAscension() : 0;
      case 'pvp': return 'special';
      case 'bounties': return progress().totalBounties || 0;
      case 'power': return cb.getCardPower ? cb.getCardPower() : 0;
    }
    return 0;
  }

  function getChallengeTierReached(ch) {
    var val = getChallengeCurrentValue(ch);
    if (ch.id === 'pvp') {
      var cb = _callbacks;
      var rec = cb.getPvPRecord ? cb.getPvPRecord() : { w: 0, l: 0 };
      var elo = cb.getPvPElo ? cb.getPvPElo() : 1000;
      var pvpRank = cb.getPvPRank ? cb.getPvPRank(elo) : null;
      if (rec.w < 3) return 0;
      if (rec.w < 10) return 1;
      var pvpRanks = cb.getPvPRanks ? cb.getPvPRanks() : [];
      var rankNames = pvpRanks.map(function(r) { return r.name; });
      var goldIdx = rankNames.indexOf('Gold');
      var curIdx = pvpRanks.indexOf(pvpRank);
      if (curIdx >= goldIdx) return 3;
      return 2;
    }
    for (var t = ch.target.length - 1; t >= 0; t--) {
      if (val >= ch.target[t]) return t + 1;
    }
    return 0;
  }

  // ── Render Challenges ──

  function renderChallenges() {
    var el = document.getElementById('bs-challenges');
    if (!el) return;

    var data = getChallengeProgress();
    var totalTiers = CHALLENGES.length * 3;
    var claimedTiers = 0;
    CHALLENGES.forEach(function(ch) { claimedTiers += (data[ch.id] || 0); });

    var tierColors = ['#CD7F32', '#C0C0C0', '#FFD700'];
    var tierNames = ['Bronze', 'Silver', 'Gold'];

    var rows = CHALLENGES.map(function(ch) {
      var currentVal = getChallengeCurrentValue(ch);
      var reached = getChallengeTierReached(ch);
      var claimed = data[ch.id] || 0;

      var stars = '';
      for (var t = 0; t < 3; t++) {
        if (t < claimed) {
          stars += '<i class="fas fa-star" style="color:' + tierColors[t] + ';" aria-label="' + tierNames[t] + ' claimed"></i>';
        } else if (t < reached) {
          stars += '<i class="fas fa-star" style="color:' + tierColors[t] + '; opacity: 0.5;" aria-label="' + tierNames[t] + ' earned"></i>';
        } else {
          stars += '<i class="far fa-star" style="color: var(--bs-text-muted); opacity: 0.3;" aria-label="' + tierNames[t] + ' locked"></i>';
        }
      }

      var nextTier = Math.min(claimed, 2);
      var nextTarget = ch.target[nextTier];
      var nextDesc = ch.desc[nextTier];
      var pct = 0;
      if (claimed < 3) {
        if (ch.id === 'pvp') {
          pct = reached > claimed ? 100 : 50;
        } else if (typeof nextTarget === 'number' && typeof currentVal === 'number') {
          pct = Math.min(100, Math.round((currentVal / nextTarget) * 100));
        }
      } else {
        pct = 100;
      }

      return '<div class="bs-challenge" role="listitem">'
        + '<div class="bs-challenge__icon"><i class="fas ' + ch.icon + '" aria-hidden="true"></i></div>'
        + '<div class="bs-challenge__info">'
        + '<div class="bs-challenge__name">' + escHtml(ch.name) + '</div>'
        + '<div class="bs-challenge__desc">' + escHtml(claimed < 3 ? nextDesc : 'All tiers complete!') + '</div>'
        + '<div class="bs-challenge__bar"><div class="bs-challenge__fill" style="width:' + pct + '%;"></div></div>'
        + '</div>'
        + '<div class="bs-challenge__stars">' + stars + '</div>'
        + '</div>';
    }).join('');

    el.innerHTML =
      '<div class="bs-challenges__header" id="bs-challenges-toggle">' +
        '<span><i class="fas fa-trophy" aria-hidden="true"></i> Challenges</span>' +
        '<span class="bs-challenges__count" aria-label="' + claimedTiers + ' of ' + totalTiers + ' tiers complete">' + claimedTiers + '/' + totalTiers + '</span>' +
      '</div>' +
      '<div class="bs-challenges__list" id="bs-challenges-list" role="list">' + rows + '</div>';

    el.style.display = '';

    var toggle = document.getElementById('bs-challenges-toggle');
    var list = document.getElementById('bs-challenges-list');
    if (toggle && list) {
      var collapsed = localStorage.getItem('bs-challenges-collapsed') === 'true';
      if (collapsed) list.style.display = 'none';
      toggle.style.cursor = 'pointer';
      toggle.onclick = function() {
        var isHidden = list.style.display === 'none';
        list.style.display = isHidden ? '' : 'none';
        safeLSSet('bs-challenges-collapsed', isHidden ? 'false' : 'true');
      };
    }
  }

  // ── Daily Bounties ──

  function getDailyBounties() {
    var today = new Date().toISOString().slice(0, 10);
    var stored = progress().bounties;
    if (!stored || stored.date !== today) {
      var shuffled = BOUNTY_POOL.slice().sort(function() { return Math.random() - 0.5; });
      var bounties = shuffled.slice(0, 3).map(function(b) { return { id: b.id, text: b.text, check: b.check, reward: b.reward, done: false }; });
      progress().bounties = { date: today, bounties: bounties, fights: 0 };
      return progress().bounties;
    }
    return stored;
  }

  function renderBounties() {
    var el = document.getElementById('bs-bounties');
    if (!el) return;

    var data = getDailyBounties();
    var doneCount = data.bounties.filter(function(b) { return b.done; }).length;

    el.innerHTML =
      '<div class="bs-bounties__header">'
      + '<span><i class="fas fa-scroll" aria-hidden="true"></i> Daily Bounties</span>'
      + '<span class="bs-bounties__count" aria-label="' + doneCount + ' of 3 bounties complete">' + doneCount + '/3</span>'
      + '</div>'
      + data.bounties.map(function(b) {
          return '<div class="bs-bounty ' + (b.done ? 'bs-bounty--done' : '') + '" role="listitem">'
            + '<i class="fas ' + (b.done ? 'fa-check-circle' : 'fa-circle') + '" aria-hidden="true"></i>'
            + '<span>' + escHtml(b.text) + '</span>'
            + (b.reward ? '<span class="bs-bounty__reward">' + escHtml(b.reward.label) + '</span>' : '')
            + '</div>';
        }).join('');
    el.style.display = '';
  }

  // ── Public API ──

  return {
    CHALLENGES: CHALLENGES,
    BOUNTY_POOL: BOUNTY_POOL,
    getChallengeProgress: getChallengeProgress,
    saveChallengeProgress: saveChallengeProgress,
    getChallengeClaimedTier: getChallengeClaimedTier,
    getChallengeCurrentValue: getChallengeCurrentValue,
    getChallengeTierReached: getChallengeTierReached,
    getDailyBounties: getDailyBounties,
    renderChallenges: renderChallenges,
    renderBounties: renderBounties,
    setCallbacks: function (cbs) { _callbacks = cbs; }
  };
})();
