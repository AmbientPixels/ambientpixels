// promptBuilder.js — ConversionCore LLM prompt templates
// 4-stage pipeline: extraction → 2 grouped evaluations → synthesis

const { getDimensionsForGroup, WEIGHT_PROFILES } = require('./dimensions');

// ── Stage 0: Site-Type Classification ────────────────────────────

function buildClassificationPrompt(extractionResult) {
  return `You are a website categorization expert. Based on the extracted conversion data below, classify this website into EXACTLY ONE of these site types:

- **direct_response_saas**: SaaS products with self-serve signup/trial (e.g. Basecamp, Calendly, Notion). Conversion = sign-up or free trial.
- **enterprise_platform**: Enterprise/infrastructure products where the buyer journey is long and complex (e.g. Stripe, AWS, Snowflake). Conversion = demo request or contact sales.
- **ecommerce**: Online stores selling physical or digital products (e.g. Shopify stores, Amazon). Conversion = add-to-cart or purchase.
- **content_publisher**: Media, blogs, news sites where conversion = subscription, newsletter, or engagement (e.g. Substack, Medium, NYT).
- **media_entertainment**: Streaming, gaming, entertainment platforms (e.g. Netflix, Spotify, Twitch). Conversion = subscription or engagement.
- **local_service**: Local businesses, service providers, restaurants, clinics (e.g. a dentist's website, a local plumber). Conversion = booking, phone call, or form submission.
- **agency_consulting**: Professional services, agencies, consultancies (e.g. McKinsey, a web design agency). Conversion = contact form or consultation booking.

=== EXTRACTED DATA ===
${JSON.stringify(extractionResult, null, 2)}

=== TASK ===
Return ONLY valid JSON, no markdown formatting, no code blocks:

{
  "siteType": "one_of_the_types_above",
  "confidence": "high|moderate|low",
  "reasoning": "1-2 sentences explaining why this classification fits"
}`;
}

// ── Stage 1: Extraction ──────────────────────────────────────────

function buildExtractionPrompt(scrapedData) {
  return `You are a conversion rate optimization expert. Your task is to EXTRACT and CATEGORIZE conversion-relevant elements from this website. Do NOT evaluate or score anything — only extract what exists.

=== WEBSITE DATA ===
URL: ${scrapedData.url}
Title: ${scrapedData.title || '(none)'}
Meta Description: ${scrapedData.metaDescription || '(none)'}

H1 Tags: ${(scrapedData.h1 || []).join(' | ') || '(none)'}
H2 Tags: ${(scrapedData.h2 || []).join(' | ') || '(none)'}
H3 Tags: ${(scrapedData.h3 || []).join(' | ') || '(none)'}

CTAs Found (${(scrapedData.ctas || []).length}):
${(scrapedData.ctas || []).map(c => '- "' + c.text + '" (' + c.tag + (c.href ? ', href: ' + c.href : '') + ')').join('\n') || '(none found)'}

Forms Found (${(scrapedData.forms || []).length}):
${(scrapedData.forms || []).map(f => '- ' + f.fieldCount + ' fields, method: ' + f.method + (f.fields ? ', fields: ' + f.fields.map(fl => fl.name || fl.type).join(', ') : '')).join('\n') || '(none found)'}

Social Proof Elements (${(scrapedData.socialProof || []).length}):
${(scrapedData.socialProof || []).map(s => '- [' + s.type + '] ' + (s.content || 'logo bar: ' + (s.count || 0) + ' logos')).join('\n') || '(none found)'}

Pricing:
${(scrapedData.pricing || []).join('\n') || '(none found)'}

Images: ${scrapedData.images ? scrapedData.images.total + ' total, ' + scrapedData.images.altCoverage + '% have alt text' : 'unknown'}

Navigation: ${scrapedData.navigation ? scrapedData.navigation.linkCount + ' links' : 'unknown'}
Internal Links: ${(scrapedData.internalLinks || []).length}
External Links: ${(scrapedData.externalLinks || []).length}

Open Graph: ${Object.keys(scrapedData.openGraph || {}).length > 0 ? JSON.stringify(scrapedData.openGraph) : '(none)'}
Schema.org: ${(scrapedData.schemaOrg || []).length > 0 ? 'Yes (' + scrapedData.schemaOrg.length + ' items)' : '(none)'}

Body Text (first 6000 chars):
${(scrapedData.bodyText || '').substring(0, 6000)}

=== TASK ===
Extract and categorize the conversion elements you find. Return ONLY valid JSON, no markdown formatting, no code blocks:

{
  "headline": {
    "primary": "the main H1 or hero headline text",
    "supporting": ["subheadlines or supporting text near the headline"],
    "clarity_notes": "brief factual note on what the headline communicates"
  },
  "valueProposition": {
    "stated": "the explicit value proposition if present",
    "implicit": "the implied value proposition based on content",
    "uniqueness_notes": "what makes this offering different based on claims made"
  },
  "callsToAction": [
    { "text": "CTA button/link text", "placement": "above-fold|mid-page|footer|sidebar", "type": "primary|secondary|tertiary" }
  ],
  "trustElements": [
    { "type": "testimonial|logo|badge|stat|case_study|guarantee", "content": "what was found", "strength": "strong|moderate|weak" }
  ],
  "audienceSignals": {
    "targetAudience": "who this page appears to target based on language and content",
    "languageTone": "formal|casual|technical|aspirational|urgent",
    "sophisticationLevel": "beginner|intermediate|expert"
  },
  "frictionPoints": ["observable friction elements: extra steps, confusing navigation, competing CTAs, etc."],
  "conversionPath": {
    "steps": ["step 1: land on page", "step 2: ...", "step N: convert"],
    "clarity": "clear|moderate|confusing"
  },
  "missingElements": ["notable conversion elements that are absent: no testimonials, no pricing, no CTA above fold, etc."]
}`;
}

// ── Stage 2: Grouped Evaluation ──────────────────────────────────

function buildGroupEvalPrompt(groupId, extractionResult, siteType, isJsRendered) {
  const dims = getDimensionsForGroup(groupId);
  const dimIds = Object.keys(dims);

  // Get site-type-specific scoring context
  const profile = WEIGHT_PROFILES[siteType] || WEIGHT_PROFILES['direct_response_saas'];
  const siteContext = profile.scoringContext || '';

  let rubricBlock = '';
  for (const [dimId, dim] of Object.entries(dims)) {
    rubricBlock += `\n### ${dim.label} (weight: ${dim.weight})\n${dim.description}\n\nSub-criteria:\n`;
    for (const sc of dim.subCriteria) {
      rubricBlock += `- **${sc.id}** (weight: ${sc.weight}): ${sc.description}\n`;
    }
    rubricBlock += '\n';
  }

  const jsRenderedNote = isJsRendered ? `
=== IMPORTANT: LIMITED CONTENT WARNING ===
This page appears to use client-side JavaScript rendering. The extracted data below may be INCOMPLETE — many page elements (testimonials, CTAs, pricing, imagery) may exist on the live page but are not captured in static analysis.

SCORING ADJUSTMENT FOR JS-RENDERED PAGES:
- When a sub-criterion has NO evidence in the data, score it 5 (neutral/unknown) — NOT 1-2.
- Only score 1-2 when you can see evidence that something is actively BAD, not merely absent.
- Score what IS present at its actual quality level (7-9 if well-executed).
- The missing data is a scraping limitation, not a site deficiency.
` : '';

  return `You are a senior CRO (conversion rate optimization) consultant scoring a website audit.

You are evaluating GROUP ${groupId} which contains these 4 dimensions:
${dimIds.map(id => '- ' + dims[id].label).join('\n')}

=== SITE TYPE: ${siteType || 'unknown'} ===
${siteContext}
${jsRenderedNote}
=== EXTRACTED CONVERSION DATA ===
${JSON.stringify(extractionResult, null, 2)}

=== SCORING RUBRIC ===
For each dimension, score every sub-criterion on a 1–10 scale.

Scoring guide — USE THE FULL RANGE:
- 1-2: Actively harmful or fundamentally broken. Evidence shows the element HURTS conversions.
- 3-4: Present but poorly executed. Clear deficiencies with evidence of specific problems.
- 5: Neutral/generic. Present but unoptimized. No evidence of deliberate CRO effort.
- 6: Competent. Follows standard practices. Functional but not optimized.
- 7: Good. Above-average implementation with clear intent. Minor improvements possible.
- 8: Strong. Deliberately optimized. Evidence of strategic CRO thinking. Would be hard to improve meaningfully.
- 9: Excellent. Top-tier execution. Would serve as a positive example for this site type.
- 10: World-class. Among the best implementations you've seen. Reserve for truly exceptional execution.

CALIBRATION ANCHORS (use these to calibrate your scores):
- A specific, benefit-driven headline ("Save 10 hours/week on invoicing") = 8-9 on headline_clarity
- A vague headline ("The future of work") = 4-5 on headline_clarity
- "Contact Sales" on an enterprise site = 7 on cta_action_language (appropriate for site type)
- "Submit" on a form = 3 on cta_action_language (generic, zero value language)
- Named testimonials with specific outcomes = 8-9 on social_proof_quality
- Zero testimonials or social proof = ${isJsRendered ? '5 (may be JS-rendered)' : '1-2 (genuinely absent)'}
- Clean visual hierarchy with clear focal points = 7-8 on visual_hierarchy
- Cluttered page with competing elements = 3-4 on visual_hierarchy

ANTI-COMPRESSION RULES:
- Your scores MUST span at least a 4-point range within each dimension. If all sub-criteria score 5-6, you are compressing.
- Well-executed elements score 7-9. Poorly executed elements score 1-4. The 5-6 range is NARROW — only for "present but mediocre."
- If you recognize a well-known company with professional design and clear messaging, their baseline starts at 6-7, not 4-5.
- Ask yourself: "Would I hire someone to fix this specific thing?" If no → 7+. If yes → below 6.

IMPORTANT RULES:
- You MUST cite specific evidence from the extracted data before giving a score.
- Each finding must include a concrete, actionable recommendation.
- CRITICAL: Every finding MUST include an "evidence" field that quotes the EXACT text, element, or absence from the page being critiqued.
- Score relative to the site type. ${siteContext ? siteContext : 'An enterprise platform has different conversion expectations than a direct-response SaaS landing page.'}

${rubricBlock}

=== REQUIRED OUTPUT ===
Return ONLY valid JSON, no markdown formatting, no code blocks:

{
${dimIds.map(dimId => {
    const dim = dims[dimId];
    return `  "${dimId}": {
    "scores": {
${dim.subCriteria.map(sc => `      "${sc.id}": { "score": 0, "reasoning": "cite evidence then explain score" }`).join(',\n')}
    },
    "findings": [
      { "severity": "critical|important|minor", "evidence": "quote or cite the specific element from the page", "finding": "what is wrong based on the evidence", "recommendation": "specific fix", "estimatedImpact": "high|medium|low" }
    ],
    "summary": "2-sentence summary of this dimension"
  }`;
  }).join(',\n')}
}`;
}

// ── Stage 3: Synthesis ───────────────────────────────────────────

function buildSynthesisPrompt(scoreResult, evaluations, siteType) {
  const dimSummary = Object.entries(scoreResult.dimensions)
    .map(([id, d]) => `- ${d.label}: ${d.score}/100 (${d.grade})`)
    .join('\n');

  const topFindings = scoreResult.findings.slice(0, 10)
    .map((f, i) => `${i + 1}. [${f.severity.toUpperCase()}] ${f.dimensionLabel}: ${f.finding}`)
    .join('\n');

  // Collect all CTA texts and headlines from evaluations for rewrite suggestions
  let ctaTexts = '';
  let headlines = '';
  try {
    const ext = typeof evaluations._extraction === 'object' ? evaluations._extraction : {};
    if (ext.callsToAction) {
      ctaTexts = ext.callsToAction.map(c => c.text).join(', ');
    }
    if (ext.headline) {
      headlines = ext.headline.primary || '';
      if (ext.headline.supporting) headlines += ' | ' + ext.headline.supporting.join(' | ');
    }
  } catch { /* extraction data not available */ }

  const siteTypeLabel = (siteType || 'unknown').replace(/_/g, ' ');

  return `You are writing the executive summary and strategic recommendations for a website conversion audit report.

=== SITE TYPE: ${siteTypeLabel} ===
=== CONVERSION HEALTH SCORE: ${scoreResult.score}/100 (${scoreResult.grade}) ===

=== DIMENSION SCORES ===
${dimSummary}

=== TOP FINDINGS (by severity) ===
${topFindings}

=== CURRENT HEADLINES ===
${headlines || '(not available)'}

=== CURRENT CTA TEXT ===
${ctaTexts || '(not available)'}

=== TASK ===
Write the following sections. Be specific, not generic. Reference actual content from the site.

TONE RULES:
- Confident and direct, never insulting or defensive-triggering
- Say "currently underperforms in" NOT "fails at" or "performs poorly"
- Say "opportunity to strengthen" NOT "weakness in"
- Frame problems as revenue opportunity cost, not criticism
- Include directional financial framing where possible (e.g. "sites in this range typically convert 30-50% below potential based on messaging and CTA friction")
- For impact estimates, use ranges not precise numbers (e.g. "15-30%" not "20%"). Ranges feel more credible.
- Phrase impact as: "Expected Impact: Moderate to High — improved clarity typically increases engagement by 15-30%."

Return ONLY valid JSON, no markdown formatting, no code blocks:

{
  "executiveSummary": "3-4 sentences: What this site does well, what is costing them conversions, and a financial framing line (e.g. 'Based on current messaging clarity and CTA strength, [site] is likely converting below industry average for similar [industry] firms.' or 'Sites in this score range typically experience 25-40% drop-off before primary conversion action.'). Be direct and specific.",
  "conversionHealthAssessment": "2-3 sentences explaining what a score of ${scoreResult.score} means practically in revenue terms. What category of sites typically score this range? Include a directional conversion impact statement.",
  "topPriorities": [
    {
      "rank": 1,
      "title": "short title of the fix",
      "description": "what to change and why it matters for conversion",
      "estimatedImpact": "Expected Impact: [Low|Moderate|High] — concise improvement statement with range (e.g. 'Moderate to High — improved clarity typically increases engagement by 15-30%')",
      "effort": "quick|medium|rebuild",
      "phase": "1-quick-wins|2-structural|3-strategic"
    },
    {
      "rank": 2,
      "title": "...",
      "description": "...",
      "estimatedImpact": "...",
      "effort": "quick|medium|rebuild",
      "phase": "1-quick-wins|2-structural|3-strategic"
    },
    {
      "rank": 3,
      "title": "...",
      "description": "...",
      "estimatedImpact": "...",
      "effort": "quick|medium|rebuild",
      "phase": "1-quick-wins|2-structural|3-strategic"
    }
  ],
  "priorityRoadmap": {
    "phase1": { "label": "Quick Wins", "items": ["short action item 1", "short action item 2"] },
    "phase2": { "label": "Structural Improvements", "items": ["short action item 1", "short action item 2"] },
    "phase3": { "label": "Strategic Enhancements", "items": ["short action item 1", "short action item 2"] }
  },
  "headlineRewrites": [
    {
      "current": "current headline text",
      "problems": ["No specific outcome stated", "No quantifiable benefit", "No audience targeting"],
      "suggested": "improved version",
      "improvements": ["Clear benefit articulation", "Improved relevance", "Increased CTA click likelihood"]
    }
  ],
  "ctaRewrites": [
    {
      "current": "current CTA text",
      "problems": ["why the current CTA underperforms"],
      "suggested": "improved version",
      "improvements": ["why the new CTA converts better"]
    }
  ],
  "analysisConfidence": {
    "level": "high|moderate|low",
    "reason": "brief explanation (e.g. 'Based on visible static content, clear CTAs, and structured page layout' or 'Dynamic content detected — some elements may not be captured')"
  },
  "strategicOpportunities": [
    "1-2 sentence description of a bigger strategic move that could significantly improve conversions"
  ]
}`;
}

module.exports = {
  buildClassificationPrompt,
  buildExtractionPrompt,
  buildGroupEvalPrompt,
  buildSynthesisPrompt
};
