// promptBuilder.js — ConversionCore LLM prompt templates
// 4-stage pipeline: extraction → 2 grouped evaluations → synthesis

const { getDimensionsForGroup } = require('./dimensions');

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

function buildGroupEvalPrompt(groupId, extractionResult) {
  const dims = getDimensionsForGroup(groupId);
  const dimIds = Object.keys(dims);

  let rubricBlock = '';
  for (const [dimId, dim] of Object.entries(dims)) {
    rubricBlock += `\n### ${dim.label} (weight: ${dim.weight})\n${dim.description}\n\nSub-criteria:\n`;
    for (const sc of dim.subCriteria) {
      rubricBlock += `- **${sc.id}** (weight: ${sc.weight}): ${sc.description}\n`;
    }
    rubricBlock += '\n';
  }

  return `You are a senior CRO (conversion rate optimization) consultant scoring a website audit.

You are evaluating GROUP ${groupId} which contains these 4 dimensions:
${dimIds.map(id => '- ' + dims[id].label).join('\n')}

=== EXTRACTED CONVERSION DATA ===
${JSON.stringify(extractionResult, null, 2)}

=== SCORING RUBRIC ===
For each dimension, score every sub-criterion on a 1–10 scale.

Scoring guide:
- 1-3: Critical issues. Likely losing significant conversions. Evidence of clear problems.
- 4-5: Below average. Notable improvement opportunities. Common mistakes present.
- 6-7: Acceptable. Functional but room for optimization. Standard implementation.
- 8-9: Strong. Well-executed with only minor refinements possible.
- 10: Exceptional. Best-in-class implementation. Hard to improve.

IMPORTANT RULES:
- You MUST cite specific evidence from the extracted data before giving a score.
- If no evidence exists for a criterion, note its absence and score accordingly.
- Do not inflate scores. A generic page should score 4-6, not 7-8.
- Each finding must include a concrete, actionable recommendation.
- CRITICAL: Every finding MUST include an "evidence" field that quotes the EXACT text, element, or absence from the page being critiqued. Example: 'Current headline: "AI, Engineered for Production." — this does not state a specific outcome or measurable benefit.' This makes findings feel forensic and premium.

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

function buildSynthesisPrompt(scoreResult, evaluations) {
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

  return `You are writing the executive summary and strategic recommendations for a website conversion audit report.

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
- Confident and direct, never insulting
- Say "currently underperforms in" NOT "fails at"
- Say "opportunity to strengthen" NOT "weakness in"
- Frame problems as revenue opportunity cost, not criticism
- Include directional financial framing where possible (e.g. "sites in this range typically experience 25-40% drop-off before primary conversion action")

Return ONLY valid JSON, no markdown formatting, no code blocks:

{
  "executiveSummary": "3-4 sentences: What this site does well, what is costing them conversions, and a financial framing line (e.g. 'Based on current messaging clarity and CTA strength, [site] is likely converting below industry average for similar [industry] firms.' or 'Sites in this score range typically experience 25-40% drop-off before primary conversion action.'). Be direct and specific.",
  "conversionHealthAssessment": "2-3 sentences explaining what a score of ${scoreResult.score} means practically in revenue terms. What category of sites typically score this range? Include a directional conversion impact statement.",
  "topPriorities": [
    {
      "rank": 1,
      "title": "short title of the fix",
      "description": "what to change and why it matters for conversion",
      "estimatedImpact": "specific expected improvement (e.g. 'Increase visitor engagement by 20% and improve lead generation by 15%')",
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
  "strategicOpportunities": [
    "1-2 sentence description of a bigger strategic move that could significantly improve conversions"
  ]
}`;
}

module.exports = {
  buildExtractionPrompt,
  buildGroupEvalPrompt,
  buildSynthesisPrompt
};
