// dimensions.js — ConversionCore 8-dimension evaluation model
// Defines dimensions, sub-criteria, weights, and groupings for LLM evaluation

const DIMENSIONS = {
  messaging_clarity: {
    weight: 0.15,
    label: 'Messaging Clarity',
    group: 'A',
    description: 'Can a visitor understand what you offer and why it matters within 5 seconds?',
    subCriteria: [
      { id: 'headline_clarity', weight: 0.35, description: 'Is the primary headline instantly understandable? Does it state a concrete outcome or benefit?' },
      { id: 'value_prop_specificity', weight: 0.30, description: 'Does the value proposition contain specific, measurable, or tangible benefits rather than vague claims?' },
      { id: 'jargon_avoidance', weight: 0.20, description: 'Is language accessible to the target buyer? Is industry jargon minimized or explained?' },
      { id: 'message_consistency', weight: 0.15, description: 'Is the core message consistent from headline through body to CTA? No contradictions or topic drift?' }
    ]
  },

  cta_strength: {
    weight: 0.15,
    label: 'CTA Strength',
    group: 'A',
    description: 'Are calls-to-action visible, compelling, and action-oriented?',
    subCriteria: [
      { id: 'cta_visibility', weight: 0.25, description: 'Are CTAs visually prominent? Above the fold? High contrast against the background?' },
      { id: 'cta_action_language', weight: 0.25, description: 'Do CTAs use specific action verbs with implied value? (e.g., "Start saving today" vs "Submit")' },
      { id: 'cta_value_alignment', weight: 0.25, description: 'Does the CTA text match the value promised in the surrounding content?' },
      { id: 'cta_placement', weight: 0.25, description: 'Are CTAs placed at natural decision points? Is there a CTA visible without scrolling?' }
    ]
  },

  funnel_friction: {
    weight: 0.15,
    label: 'Funnel Friction',
    group: 'A',
    description: 'How easy is it for a motivated visitor to take the desired action?',
    subCriteria: [
      { id: 'step_count', weight: 0.25, description: 'How many clicks/steps from landing to conversion? Fewer is better.' },
      { id: 'cognitive_load', weight: 0.30, description: 'Is the page overwhelming? Too many choices, competing CTAs, or information overload?' },
      { id: 'form_optimization', weight: 0.25, description: 'Are forms minimal? Only essential fields? Clear labels and helpful error states?' },
      { id: 'distraction_level', weight: 0.20, description: 'Are there exit points, competing links, or elements that pull attention away from the conversion path?' }
    ]
  },

  conversion_hierarchy: {
    weight: 0.10,
    label: 'Conversion Hierarchy',
    group: 'A',
    description: 'Does the visual and information hierarchy guide the eye toward conversion?',
    subCriteria: [
      { id: 'visual_hierarchy', weight: 0.30, description: 'Is there a clear visual hierarchy using size, color, and whitespace to prioritize conversion elements?' },
      { id: 'information_flow', weight: 0.35, description: 'Does information flow logically: problem → solution → proof → action? Is the persuasion sequence correct?' },
      { id: 'progressive_disclosure', weight: 0.35, description: 'Is information revealed at the right time? Not too much upfront, not burying key details?' }
    ]
  },

  trust_signals: {
    weight: 0.15,
    label: 'Trust Signals',
    group: 'B',
    description: 'Does the page provide sufficient evidence that this business is credible and low-risk?',
    subCriteria: [
      { id: 'social_proof_quality', weight: 0.30, description: 'Are testimonials specific and attributed? Do they mention outcomes, not just praise?' },
      { id: 'authority_markers', weight: 0.25, description: 'Client logos, media mentions, certifications, awards, years in business, team credentials?' },
      { id: 'risk_reversal', weight: 0.25, description: 'Is there a guarantee, free trial, money-back promise, or other risk reducer?' },
      { id: 'transparency', weight: 0.20, description: 'Is pricing visible? Are there clear contact details? Privacy policy? No hidden costs?' }
    ]
  },

  differentiation: {
    weight: 0.10,
    label: 'Differentiation',
    group: 'B',
    description: 'Does the page make clear why THIS solution over alternatives?',
    subCriteria: [
      { id: 'unique_mechanism', weight: 0.35, description: 'Is there a clearly articulated unique approach, method, or technology that sets this apart?' },
      { id: 'competitor_contrast', weight: 0.30, description: 'Does the page address why visitors should choose this over alternatives, even implicitly?' },
      { id: 'category_ownership', weight: 0.35, description: 'Does the page own a specific niche or category, or could any competitor use the same copy?' }
    ]
  },

  audience_alignment: {
    weight: 0.10,
    label: 'Audience Alignment',
    group: 'B',
    description: 'Does the language and framing match the likely buyer?',
    subCriteria: [
      { id: 'language_match', weight: 0.35, description: 'Does the tone and vocabulary match the target audience? Technical for developers, simple for consumers, strategic for executives?' },
      { id: 'pain_point_addressing', weight: 0.35, description: 'Does the page name specific pain points the target audience experiences? Or is it self-focused on features?' },
      { id: 'sophistication_calibration', weight: 0.30, description: 'Is the content appropriately detailed? Not over-explaining for experts, not under-explaining for beginners?' }
    ]
  },

  quick_wins: {
    weight: 0.10,
    label: 'Quick-Win Fixes',
    group: 'B',
    description: 'What low-effort, high-impact changes could be made in a single day?',
    subCriteria: [
      { id: 'low_hanging_fruit_count', weight: 0.40, description: 'How many easy, obvious improvements exist? More quick wins = lower score (more room for improvement).' },
      { id: 'implementation_ease', weight: 0.30, description: 'How simple are the top fixes to implement? Copy change vs structural rebuild?' },
      { id: 'expected_impact', weight: 0.30, description: 'How much conversion improvement could the quick wins deliver if implemented?' }
    ]
  }
};

// Group definitions for batched LLM calls
const GROUPS = {
  A: ['messaging_clarity', 'cta_strength', 'funnel_friction', 'conversion_hierarchy'],
  B: ['trust_signals', 'differentiation', 'audience_alignment', 'quick_wins']
};

// Grade mapping
function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

// Get dimensions for a given group
function getDimensionsForGroup(groupId) {
  const dimIds = GROUPS[groupId] || [];
  const result = {};
  for (const id of dimIds) {
    if (DIMENSIONS[id]) result[id] = DIMENSIONS[id];
  }
  return result;
}

module.exports = { DIMENSIONS, GROUPS, scoreToGrade, getDimensionsForGroup };
