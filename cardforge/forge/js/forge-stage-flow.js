/* forge-stage-flow.js — 7-stage navigation with per-stage gating.
 * Per redesign-handoff.md §6 + Phase 4 Task 4.2.
 *
 * Depends on window.ForgeState (forge-state.js must load first).
 *
 * API:
 *   window.ForgeStageFlow.goTo(stageId)      → advance or jump to a stage (gated)
 *   window.ForgeStageFlow.next()             → advance one stage if gate passes
 *   window.ForgeStageFlow.prev()             → go back one stage (no gating)
 *   window.ForgeStageFlow.canAdvance(fromId) → gate check for that stage's exit
 *
 * Stage gates:
 *   identity    → needs name.length > 0
 *   card-design → always true (styleId defaults to 'ember')
 *   vitals      → always true (stats defaults non-null)
 *   overlays    → no gate
 *   lore        → no gate (optional)
 *   preview     → no gate
 *   mint        → terminal stage; cannot advance past
 */

(function () {
  'use strict';

  var STAGE_ORDER = ['identity', 'card-design', 'vitals', 'overlays', 'lore', 'preview', 'mint'];

  // Dwell-time tracking for telemetry (stage.enter events)
  var _stageEnteredAt = Date.now();

  function canAdvance(fromStageId) {
    if (!window.ForgeState) return true;
    var state = window.ForgeState.get();
    switch (fromStageId) {
      case 'identity':
        return typeof state.name === 'string' && state.name.trim().length > 0;
      case 'card-design':
        return !!state.styleId;
      case 'vitals':
        return !!state.stats;
      case 'overlays':
      case 'lore':
      case 'preview':
        return true;
      case 'mint':
        return false; // terminal
      default:
        return true;
    }
  }

  function emitStageEnter(from, to) {
    if (!window.ForgeTelemetry || typeof window.ForgeTelemetry.track !== 'function') return;
    var state = window.ForgeState ? window.ForgeState.get() : {};
    window.ForgeTelemetry.track('stage.enter', {
      from: from,
      to: to,
      hasName: !!(state.name && state.name.trim()),
      styleId: state.styleId,
      elapsedMs: Date.now() - _stageEnteredAt
    });
  }

  function goTo(targetStageId) {
    if (!window.ForgeState) return false;
    var idx = STAGE_ORDER.indexOf(targetStageId);
    if (idx < 0) return false;

    var current = window.ForgeState.get().activeStage;
    var currentIdx = STAGE_ORDER.indexOf(current);

    // Forward jump: gate every stage between current and target.
    // Backward jump: always allowed (no gate).
    if (idx > currentIdx) {
      for (var i = currentIdx; i < idx; i++) {
        if (!canAdvance(STAGE_ORDER[i])) {
          return false;
        }
      }
    }

    emitStageEnter(current, targetStageId);
    _stageEnteredAt = Date.now();
    window.ForgeState.set({ activeStage: targetStageId });
    return true;
  }

  function next() {
    if (!window.ForgeState) return false;
    var current = window.ForgeState.get().activeStage;
    var idx = STAGE_ORDER.indexOf(current);
    if (idx < 0 || idx >= STAGE_ORDER.length - 1) return false;
    if (!canAdvance(current)) return false;
    return goTo(STAGE_ORDER[idx + 1]);
  }

  function prev() {
    if (!window.ForgeState) return false;
    var current = window.ForgeState.get().activeStage;
    var idx = STAGE_ORDER.indexOf(current);
    if (idx <= 0) return false;
    return goTo(STAGE_ORDER[idx - 1]);
  }

  window.ForgeStageFlow = {
    STAGE_ORDER: STAGE_ORDER,
    goTo: goTo,
    next: next,
    prev: prev,
    canAdvance: canAdvance
  };
})();
