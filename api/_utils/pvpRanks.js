/**
 * pvpRanks.js — Shared PvP rank utilities for wager system
 *
 * Mirrors BsConst.PVP_RANKS from the frontend (bs-constants.js:25-32)
 * Used by: blindspotasyncbattle (peakRank update), cardforge-challenger, cardforge-skull-ante
 */

const PVP_RANK_ORDER = [
  { name: 'Iron',     min: 0 },
  { name: 'Bronze',   min: 900 },
  { name: 'Silver',   min: 1100 },
  { name: 'Gold',     min: 1300 },
  { name: 'Platinum', min: 1500 },
  { name: 'Diamond',  min: 1700 }
];

/**
 * Get PvP rank name from Elo rating
 * @param {number} elo
 * @returns {string} rank name (e.g. 'Gold')
 */
function getPvpRankName(elo) {
  let rank = 'Iron';
  for (let i = PVP_RANK_ORDER.length - 1; i >= 0; i--) {
    if (elo >= PVP_RANK_ORDER[i].min) {
      rank = PVP_RANK_ORDER[i].name;
      break;
    }
  }
  return rank;
}

/**
 * Get index of a rank name in PVP_RANK_ORDER (0 = Iron, 5 = Diamond)
 * Returns 0 if not found
 * @param {string} rankName
 * @returns {number}
 */
function getPvpRankIndex(rankName) {
  const idx = PVP_RANK_ORDER.findIndex(r => r.name === rankName);
  return idx >= 0 ? idx : 0;
}

/**
 * Check if two peak ranks are within ±1 of each other (matchmaking gate)
 * @param {string} peakA
 * @param {string} peakB
 * @returns {boolean}
 */
function isWithinRankRange(peakA, peakB) {
  const idxA = getPvpRankIndex(peakA || 'Iron');
  const idxB = getPvpRankIndex(peakB || 'Iron');
  return Math.abs(idxA - idxB) <= 1;
}

/**
 * Update peakRank on a profile if new Elo pushes to a higher rank
 * @param {object} profile - must have pvpElo and peakRank fields
 * @param {number} newElo - the new Elo after a match
 * @returns {boolean} true if peakRank was updated
 */
function maybeUpdatePeakRank(profile, newElo) {
  const currentPeakIdx = getPvpRankIndex(profile.peakRank || 'Iron');
  const newRankName = getPvpRankName(newElo);
  const newRankIdx = getPvpRankIndex(newRankName);

  if (newRankIdx > currentPeakIdx) {
    profile.peakRank = newRankName;
    return true;
  }
  return false;
}

module.exports = {
  PVP_RANK_ORDER,
  getPvpRankName,
  getPvpRankIndex,
  isWithinRankRange,
  maybeUpdatePeakRank
};
