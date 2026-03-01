#!/usr/bin/env node
// seed-demo.js — Seed demo data into the demo SWA
// Usage: DEMO_API=https://kind-ocean-06c6f7b10.4.azurestaticapps.net node scripts/seed-demo.js

const DEMO_API = process.env.DEMO_API || 'https://kind-ocean-06c6f7b10.4.azurestaticapps.net';
const SECRET = process.env.COMPANY_WRITE_SECRET || 'pixelpusher';

async function seed(key, value) {
  const res = await fetch(DEMO_API + '/api/company-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-company-secret': SECRET },
    body: JSON.stringify({ key, value })
  });
  const data = await res.json();
  if (data.status === 'saved') {
    console.log('  [OK] ' + key);
  } else {
    console.error('  [FAIL] ' + key + ':', JSON.stringify(data));
  }
}

// --- Helpers ---
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString();
}
function hoursAgo(n) {
  const d = new Date(); d.setHours(d.getHours() - n);
  return d.toISOString();
}

// ============================================================
// IDENTITY — Story Stream
// ============================================================
const identity = {
  companyName: 'Story Stream',
  founder: 'Will Frasier',
  tagline: 'AI-powered developmental editing for manuscripts',
  founded: '2024',
  mission: 'Make professional-quality developmental editing accessible to every author, at every stage of their journey.',
  brandVoice: 'Warm, knowledgeable, encouraging. We speak writer-to-writer — never condescending, always constructive. Think trusted mentor, not corporate machine.',
  primaryColor: '#1a4d7a',
  values: ['craft', 'accessibility', 'honesty', 'empowerment'],
  customFields: {
    industry: 'Publishing / EdTech',
    product: 'AI developmental editing reports for manuscripts',
    plans: 'Blueprint (free), First Edition ($99), Masterpiece ($199)',
    founderBio: 'Will Frasier — novelist, musician, former Principal AI Researcher at Microsoft'
  }
};

// ============================================================
// AGENT CONFIGS
// ============================================================
const agentConfigs = [
  { id: 'nova', name: 'Nova', role: 'Prime Operator', icon: 'crown', color: '#1a4d7a', active: true, lastHeartbeat: hoursAgo(1) },
  { id: 'cipher', name: 'Cipher', role: 'CFO', icon: 'chart-line', color: '#00C896', active: true, lastHeartbeat: hoursAgo(1) },
  { id: 'pixel', name: 'Pixel', role: 'Design & QC', icon: 'palette', color: '#FF6B9D', active: true, lastHeartbeat: hoursAgo(1) },
  { id: 'forge', name: 'Forge', role: 'DevOps', icon: 'server', color: '#FF8C00', active: true, lastHeartbeat: hoursAgo(1) },
  { id: 'echo', name: 'Echo', role: 'Marketing', icon: 'bullhorn', color: '#4ECDC4', active: true, lastHeartbeat: hoursAgo(1) },
  { id: 'scribe', name: 'Scribe', role: 'Head of Content', icon: 'pen-nib', color: '#9B59B6', active: true, lastHeartbeat: hoursAgo(1) },
  { id: 'scout', name: 'Scout', role: 'Research & Intel', icon: 'search', color: '#E74C3C', active: true, lastHeartbeat: hoursAgo(1) },
  { id: 'quill', name: 'Quill', role: 'Content Editor', icon: 'feather', color: '#8E44AD', active: true, lastHeartbeat: hoursAgo(1) }
];

// ============================================================
// OBJECTIVES — Story Stream Q1 2026
// ============================================================
const objectives = [
  {
    id: 'obj-001', title: 'Reach 1,000 beta users by end of Q1',
    description: 'Drive signups for Story Stream beta across all channels. Target indie authors, writing groups, and MFA programs.',
    status: 'on_track', progressPercentage: 68, owner: 'echo',
    createdAt: daysAgo(45), updatedAt: daysAgo(1),
    keyResults: [
      { text: 'Reach 500 Blueprint (free) signups', progress: 82, status: 'on_track' },
      { text: 'Convert 150 users to First Edition ($99)', progress: 60, status: 'on_track' },
      { text: 'Convert 50 users to Masterpiece ($199)', progress: 44, status: 'at_risk' }
    ]
  },
  {
    id: 'obj-002', title: 'Achieve 95% report delivery under 1 hour',
    description: 'Optimize the manuscript processing pipeline so that 95% of reports are delivered within 60 minutes of upload.',
    status: 'on_track', progressPercentage: 88, owner: 'forge',
    createdAt: daysAgo(45), updatedAt: daysAgo(2),
    keyResults: [
      { text: 'Median processing time under 30 minutes', progress: 92, status: 'on_track' },
      { text: 'P95 processing time under 60 minutes', progress: 85, status: 'on_track' },
      { text: 'Zero failed report generations in production', progress: 78, status: 'at_risk' }
    ]
  },
  {
    id: 'obj-003', title: 'Publish 15 content pieces for author community',
    description: 'Build Story Stream\'s content library with blog posts, writing guides, and case studies to establish thought leadership in the developmental editing space.',
    status: 'at_risk', progressPercentage: 40, owner: 'scribe',
    createdAt: daysAgo(45), updatedAt: daysAgo(3),
    keyResults: [
      { text: 'Publish 8 blog posts on writing craft + editing', progress: 50, status: 'on_track' },
      { text: 'Publish 4 author success stories / testimonials', progress: 25, status: 'at_risk' },
      { text: 'Publish 3 guides (query letters, revision workflow, genre expectations)', progress: 33, status: 'behind' }
    ]
  }
];

// ============================================================
// CAMPAIGNS — Story Stream
// ============================================================
const campaigns = [
  {
    id: 'cmp-001', title: 'Beta Launch — Author Community Push',
    description: 'Multi-channel campaign targeting indie authors, writing communities, and NaNoWriMo alumni. Focus on Blueprint (free) signups as top-of-funnel.',
    status: 'active', objective_id: 'obj-001', division: 'marketing',
    provenance: 'manual', cadence: 'weekly', startDate: daysAgo(30), endDate: daysAgo(-60),
    createdAt: daysAgo(35), updatedAt: daysAgo(1), deletedAt: null
  },
  {
    id: 'cmp-002', title: 'Content Authority — Developmental Editing Blog',
    description: 'Establish Story Stream as a thought leader in developmental editing. Weekly blog posts on craft, revision, and the publishing journey.',
    status: 'active', objective_id: 'obj-003', division: 'content',
    provenance: 'standup', cadence: 'weekly', startDate: daysAgo(21), endDate: daysAgo(-60),
    createdAt: daysAgo(21), updatedAt: daysAgo(2), deletedAt: null
  },
  {
    id: 'cmp-003', title: 'Pipeline Performance Sprint',
    description: 'Two-week engineering sprint to optimize manuscript processing time and reduce Gemini API costs per report.',
    status: 'completed', objective_id: 'obj-002', division: 'engineering',
    provenance: 'standup', cadence: null, startDate: daysAgo(21), endDate: daysAgo(7),
    createdAt: daysAgo(21), updatedAt: daysAgo(7), deletedAt: null
  }
];

// ============================================================
// TASKS — Story Stream
// ============================================================
const tasks = [
  // Active tasks
  {
    id: 'task-001', taskNumber: 1,
    title: 'Draft LinkedIn post: "Why developmental editing costs $99, not $5,000"',
    description: 'Write a LinkedIn post explaining how AI makes professional editing accessible. Highlight Blueprint free tier as entry point. Include link to signup.',
    status: 'in_progress', priority: 'high', assignee: 'echo', division: 'marketing',
    tags: ['social', 'linkedin', 'pricing'], campaign_id: 'cmp-001', objective_id: 'obj-001',
    createdAt: daysAgo(2), updatedAt: hoursAgo(3)
  },
  {
    id: 'task-002', taskNumber: 2,
    title: 'Review Q1 Gemini API cost-per-report analysis',
    description: 'Break down API costs per report tier (Blueprint vs First Edition vs Masterpiece). Identify which report dimensions consume the most tokens.',
    status: 'in_progress', priority: 'medium', assignee: 'cipher', division: 'finance',
    tags: ['costs', 'reporting', 'api'], campaign_id: 'cmp-003', objective_id: 'obj-002',
    createdAt: daysAgo(3), updatedAt: hoursAgo(6)
  },
  {
    id: 'task-003', taskNumber: 3,
    title: 'Write blog post: "What Is Developmental Editing? (And Why Every Author Needs It)"',
    description: 'Foundational SEO content piece targeting authors who don\'t know what dev editing is. Explain the difference between dev editing, copy editing, and proofreading.',
    status: 'todo', priority: 'high', assignee: 'scribe', division: 'content',
    tags: ['blog', 'seo', 'educational'], campaign_id: 'cmp-002', objective_id: 'obj-003',
    createdAt: daysAgo(5), updatedAt: daysAgo(5)
  },
  {
    id: 'task-004', taskNumber: 4,
    title: 'Audit report output design for readability',
    description: 'Review the visual layout of generated reports (Publication Readiness Score, scene heat-map, action plan). Ensure consistent typography, spacing, and mobile responsiveness.',
    status: 'todo', priority: 'medium', assignee: 'pixel', division: 'design',
    tags: ['ux', 'audit', 'reports'], objective_id: 'obj-002',
    createdAt: daysAgo(4), updatedAt: daysAgo(4)
  },
  {
    id: 'task-005', taskNumber: 5,
    title: 'Research competitor landscape: AI editing tools',
    description: 'Analyze pricing, features, and positioning of Sudowrite, ProWritingAid, Fictionary, and other AI editing tools. Summarize in a competitive intel spec.',
    status: 'in_progress', priority: 'medium', assignee: 'scout', division: 'research',
    tags: ['competitive', 'market-research'], objective_id: 'obj-001',
    createdAt: daysAgo(6), updatedAt: hoursAgo(12)
  },
  {
    id: 'task-006', taskNumber: 6,
    title: 'Optimize manuscript chunking for large novels (100K+ words)',
    description: 'Current pipeline struggles with manuscripts over 100K words. Implement streaming chunk processing to stay under the 1-hour SLA.',
    status: 'todo', priority: 'high', assignee: 'forge', division: 'engineering',
    tags: ['pipeline', 'performance', 'scaling'], campaign_id: 'cmp-003', objective_id: 'obj-002',
    createdAt: daysAgo(1), updatedAt: daysAgo(1)
  },
  {
    id: 'task-007', taskNumber: 7,
    title: 'Edit and proofread: "5 Revision Strategies That Actually Work"',
    description: 'Review Scribe\'s draft blog post for tone, grammar, and brand voice alignment. Ensure it reads writer-to-writer, not corporate.',
    status: 'in_progress', priority: 'medium', assignee: 'quill', division: 'content',
    tags: ['editing', 'blog'], campaign_id: 'cmp-002', objective_id: 'obj-003',
    createdAt: daysAgo(1), updatedAt: hoursAgo(2)
  },
  {
    id: 'task-008', taskNumber: 8,
    title: 'Create social content calendar for March — writing community focus',
    description: 'Plan 3 posts/week across X, LinkedIn, and Bluesky. Themes: #WritingCommunity tips, report previews, author testimonials, craft insights.',
    status: 'todo', priority: 'high', assignee: 'echo', division: 'marketing',
    tags: ['social', 'planning', 'calendar'], campaign_id: 'cmp-001', objective_id: 'obj-001',
    createdAt: daysAgo(2), updatedAt: daysAgo(2)
  },
  // Done tasks
  {
    id: 'task-009', taskNumber: 9,
    title: 'Publish blog post: "Your Manuscript Deserves More Than a Grammar Check"',
    description: 'Position Story Stream as the step beyond Grammarly — structural feedback, not just surface corrections.',
    status: 'done', priority: 'medium', assignee: 'scribe', division: 'content',
    tags: ['blog', 'published'], campaign_id: 'cmp-002', objective_id: 'obj-003',
    createdAt: daysAgo(10), updatedAt: daysAgo(7), completedAt: daysAgo(7)
  },
  {
    id: 'task-010', taskNumber: 10,
    title: 'Fix .docx parser edge case — tracked changes causing crash',
    description: 'Manuscripts with "Track Changes" enabled were crashing the parser. Added pre-processing step to accept/strip changes before analysis.',
    status: 'done', priority: 'high', assignee: 'forge', division: 'engineering',
    tags: ['bugfix', 'parser'], objective_id: 'obj-002',
    createdAt: daysAgo(8), updatedAt: daysAgo(6), completedAt: daysAgo(6)
  },
  {
    id: 'task-011', taskNumber: 11,
    title: 'Draft X thread: "I fed my novel to an AI editor — here\'s what happened"',
    description: 'Write a 5-tweet thread from Will\'s perspective showing a real report walkthrough. Authentic, not salesy.',
    status: 'done', priority: 'medium', assignee: 'echo', division: 'marketing',
    tags: ['social', 'x', 'storytelling'], campaign_id: 'cmp-001', objective_id: 'obj-001',
    createdAt: daysAgo(12), updatedAt: daysAgo(9), completedAt: daysAgo(9)
  },
  {
    id: 'task-012', taskNumber: 12,
    title: 'Negotiate volume pricing with Google Cloud for Gemini Pro',
    description: 'Our per-report Gemini costs need to come down as volume grows. Explore committed-use discounts or startup credits.',
    status: 'done', priority: 'low', assignee: 'cipher', division: 'finance',
    tags: ['costs', 'vendor', 'negotiation'],
    createdAt: daysAgo(15), updatedAt: daysAgo(10), completedAt: daysAgo(10)
  }
];

// ============================================================
// ACTIONS + APPROVAL QUEUE
// ============================================================
const actions = [
  {
    id: 'act-001', type: 'linkedin_post', platform: 'linkedin', created_by: 'echo',
    created_at: hoursAgo(4), requires_ceo_approval: true,
    classification: 'advisory', risk_level: 'low', budget_impact: 0, brand_impact: 'medium',
    payload: {
      text: 'Most authors will never afford a $3,000 developmental edit.\n\nThat\'s why we built Story Stream — AI-powered feedback on your manuscript\'s structure, pacing, characters, and market fit.\n\nStart free with our Blueprint report. No credit card needed.\n\n#WritingCommunity #AmWriting #IndieAuthors',
      url: 'https://storystream.ai'
    },
    approval: { status: 'pending', approved_by: null, approved_at: null },
    execution: { status: 'pending' },
    execution_status: 'pending', action_type: 'linkedin_post', origin_agent: 'echo', action_category: 'social'
  },
  {
    id: 'act-002', type: 'twitter_post', platform: 'twitter', created_by: 'echo',
    created_at: hoursAgo(6), requires_ceo_approval: true,
    classification: 'advisory', risk_level: 'low', budget_impact: 0, brand_impact: 'low',
    payload: {
      text: 'Your novel deserves more than a grammar check.\n\nStory Stream gives you a developmental edit — structure, pacing, characters, market positioning — in under an hour.\n\nFree tier available. Link in bio.'
    },
    approval: { status: 'approved', approved_by: 'CEO', approved_at: hoursAgo(5) },
    execution: { status: 'success', completed_at: hoursAgo(5), receipt: { platform_id: 'tw_ss_001' } },
    execution_status: 'success', action_type: 'twitter_post', origin_agent: 'echo', action_category: 'social'
  },
  {
    id: 'act-003', type: 'linkedin_post', platform: 'linkedin', created_by: 'scribe',
    created_at: hoursAgo(8), requires_ceo_approval: true,
    classification: 'advisory', risk_level: 'low', budget_impact: 0, brand_impact: 'medium',
    payload: {
      text: 'New on the blog: "Your Manuscript Deserves More Than a Grammar Check"\n\nWhy structural feedback matters more than surface-level corrections — and how to get it without spending thousands.\n\nRead more →',
      url: 'https://storystream.ai/blog/more-than-grammar-check'
    },
    approval: { status: 'approved', approved_by: 'CEO', approved_at: hoursAgo(7) },
    execution: { status: 'success', completed_at: hoursAgo(7), receipt: { platform_id: 'li_ss_001' } },
    execution_status: 'success', action_type: 'linkedin_post', origin_agent: 'scribe', action_category: 'social'
  }
];

const approvalQueue = [
  {
    id: 'aq-act-001', kind: 'action', action_id: 'act-001',
    taskTitle: 'LinkedIn Post — Affordable developmental editing',
    originAgent: 'echo',
    classification: 'advisory', riskLevel: 'low', budgetImpact: 0, brandImpact: 'medium',
    status: 'pending', timestamp: hoursAgo(4),
    preview: 'Most authors will never afford a $3,000 developmental edit. That\'s why we built Story Stream...'
  }
];

const actionAuditLog = [
  { id: 'alog-001', type: 'action-created', data: { actionId: 'act-001', type: 'linkedin_post', agent: 'echo' }, timestamp: hoursAgo(4) },
  { id: 'alog-002', type: 'action-created', data: { actionId: 'act-002', type: 'twitter_post', agent: 'echo' }, timestamp: hoursAgo(6) },
  { id: 'alog-003', type: 'action-approved', data: { actionId: 'act-002', approvedBy: 'CEO' }, timestamp: hoursAgo(5) },
  { id: 'alog-004', type: 'action-executed', data: { actionId: 'act-002', result: 'success' }, timestamp: hoursAgo(5) },
  { id: 'alog-005', type: 'action-created', data: { actionId: 'act-003', type: 'linkedin_post', agent: 'scribe' }, timestamp: hoursAgo(8) },
  { id: 'alog-006', type: 'action-approved', data: { actionId: 'act-003', approvedBy: 'CEO' }, timestamp: hoursAgo(7) },
  { id: 'alog-007', type: 'action-executed', data: { actionId: 'act-003', result: 'success' }, timestamp: hoursAgo(7) }
];

// ============================================================
// HEARTBEAT RUNS
// ============================================================
const heartbeatRuns = [];
for (let i = 10; i >= 0; i--) {
  heartbeatRuns.push({
    id: 'hb-' + (Date.now() - i * 1800000),
    timestamp: hoursAgo(i * 0.5),
    cycle: 100 - i,
    agents: {
      nova: { status: 'ok', tasks_created: Math.floor(Math.random() * 3), observations: ['Reviewed workspace state', 'Delegated manuscript pipeline tasks', 'Updated beta signup metrics'] },
      cipher: { status: 'ok', tasks_created: 0, observations: ['Tracked Gemini API cost per report', 'Stripe revenue reconciliation complete'] },
      echo: { status: 'ok', tasks_created: 1, observations: ['Drafted social post for #WritingCommunity', 'Checked engagement on author thread'] },
      scribe: { status: 'ok', tasks_created: 1, observations: ['Continued blog draft on developmental editing', 'Reviewed document queue'] },
      pixel: { status: 'ok', tasks_created: 0, observations: ['Auditing report output readability', 'No critical design issues'] },
      forge: { status: 'ok', tasks_created: 0, observations: ['Manuscript pipeline healthy', 'P95 latency at 42 minutes', 'Uptime 99.9%'] },
      scout: { status: 'ok', tasks_created: 0, observations: ['Monitoring Sudowrite and ProWritingAid updates', 'Tracking #WritingCommunity trends'] },
      quill: { status: 'ok', tasks_created: 0, observations: ['Editing blog post draft for tone and clarity'] }
    },
    agentErrors: [],
    systemMetrics: { totalTokens: 3000 + Math.floor(Math.random() * 4000), totalCost: +(0.5 + Math.random() * 2).toFixed(2) },
    memoryUsage: { current: 30 + Math.floor(Math.random() * 30), max: 100 }
  });
}

// ============================================================
// WORKSPACE MEMORY
// ============================================================
const workspaceMemory = [
  {
    id: 'mem-001', title: 'Brand voice — writer-to-writer',
    content: 'Story Stream speaks writer-to-writer. Warm, knowledgeable, encouraging — like a trusted mentor who\'s been through the revision trenches. Never condescending, never salesy. We respect the craft and the courage it takes to share your work.',
    category: 'culture', createdAt: daysAgo(30), updatedAt: daysAgo(5), pinned: true,
    tags: ['brand', 'voice', 'guidelines']
  },
  {
    id: 'mem-002', title: 'Q1 2026 priorities',
    content: '1. Reach 1,000 beta users (focus on Blueprint free tier as top-of-funnel)\n2. 95% of reports delivered under 1 hour\n3. Publish 15 content pieces to build authority in developmental editing\n4. Keep cost-per-report under $2 (Gemini API + infrastructure)',
    category: 'strategy', createdAt: daysAgo(45), updatedAt: daysAgo(10), pinned: true,
    tags: ['strategy', 'quarterly', 'priorities']
  },
  {
    id: 'mem-003', title: 'Pricing tiers — never discount publicly',
    content: 'Blueprint: free (3 reports) — our top-of-funnel. First Edition: $99 (7 reports) — core value tier. Masterpiece: $199 (all 17 reports) — full developmental edit. Never discount publicly. Author community promos OK with CEO approval.',
    category: 'decision', createdAt: daysAgo(20), updatedAt: daysAgo(20), pinned: true,
    tags: ['pricing', 'policy']
  },
  {
    id: 'mem-004', title: 'Founder context',
    content: 'Will Frasier is the founder and CEO. Novelist, musician, former Principal AI Researcher at Microsoft. He understands both the creative and technical sides. Dr. Jessica Heaton leads DEI. Reference Will\'s background when writing thought leadership content.',
    category: 'culture', createdAt: daysAgo(30), updatedAt: daysAgo(15), pinned: false,
    tags: ['founder', 'team', 'context']
  }
];

// ============================================================
// DOCUMENTS (handbook + Story Stream-specific docs)
// ============================================================
const documents = require('../data/demo-seed-documents.json');
documents.push(
  {
    id: 'doc_1709280000001_spec', title: 'Manuscript Processing Pipeline — Technical Spec',
    kind: 'spec', status: 'draft', tags: ['pipeline', 'architecture', 'technical'],
    created_by: 'forge', created_at: daysAgo(10), updated_at: daysAgo(3),
    content_md: '# Manuscript Processing Pipeline — Technical Spec\n\n## Overview\nStory Stream\'s core product is an AI-powered developmental editing pipeline that accepts manuscript uploads (.docx, .txt) and generates structured feedback reports within one hour.\n\n## Pipeline Stages\n\n### 1. Ingestion\n- Accept .docx and .txt uploads via Stripe-gated upload form\n- Pre-process: strip tracked changes, normalize formatting, extract metadata (word count, chapter breaks)\n- Store raw manuscript in Azure Blob Storage\n\n### 2. Chunking & Analysis\n- Split manuscript into semantic chunks (chapter-level, scene-level)\n- Run each chunk through Gemini Pro for structural analysis\n- Dimensions analyzed: pacing, character arc, dialogue quality, tension curve, POV consistency\n\n### 3. Report Generation\n- **Blueprint** (3 reports): Publication Readiness Score, Executive Summary, Top-3 Action Items\n- **First Edition** (7 reports): + Scene Heat-Map, Character Arc Analysis, Pacing Graph, Dialogue Assessment\n- **Masterpiece** (17 reports): + Target Market Snapshot, Comp Title Analysis, Query Letter Draft, Full Chapter-by-Chapter Breakdown, Theme Mapping, Sensitivity Flags, Genre Convention Check, Opening Hook Analysis, Ending Impact Score, Revision Roadmap\n\n### 4. Delivery\n- Reports rendered as styled HTML + downloadable PDF\n- Email notification with direct link\n- Target SLA: < 60 minutes from upload to delivery\n\n## Performance Targets\n- Median processing: < 30 minutes\n- P95 processing: < 60 minutes\n- Max manuscript size: 200,000 words\n\n## Cost Structure\n- Gemini Pro API: ~$0.80–$1.50 per full Masterpiece report\n- Blob storage: negligible\n- Compute: Azure Functions consumption plan',
    source: { action_id: null, task_id: null }
  },
  {
    id: 'doc_1709280000002_rn', title: 'Release Notes — March 2026',
    kind: 'release_notes', status: 'draft', tags: ['release', 'march-2026'],
    created_by: 'scribe', created_at: daysAgo(5), updated_at: daysAgo(1),
    content_md: '# Release Notes — March 2026\n\n## New Features\n- **Blueprint Free Tier**: Authors can now get 3 core reports at no cost — Publication Readiness Score, Executive Summary, and Action Items\n- **Scene Heat-Map**: Visual chapter-by-chapter pacing and tension visualization (First Edition+)\n- **Target Market Snapshot**: AI-generated comp title analysis and market positioning (Masterpiece)\n\n## Improvements\n- Report delivery time reduced from ~90 min to under 60 min (P95)\n- .docx parser now handles manuscripts with tracked changes gracefully\n- Improved character arc detection for multi-POV novels\n- Upload form now shows real-time progress and estimated completion time\n\n## Bug Fixes\n- Fixed crash when uploading manuscripts with embedded images\n- Resolved edge case where chapter detection failed on unnumbered chapters\n- Fixed Stripe webhook race condition on plan upgrades',
    source: { action_id: null, task_id: null }
  },
  {
    id: 'doc_1709280000003_gov', title: 'Governance Policy — Content & Communications',
    kind: 'governance', status: 'draft', tags: ['governance', 'approval', 'content'],
    created_by: 'nova', created_at: daysAgo(30), updated_at: daysAgo(15),
    content_md: '# Governance Policy — Content & Communications\n\n## Purpose\nAll external communications must maintain Story Stream\'s writer-to-writer voice and protect author trust.\n\n## Approval Tiers\n\n### Tier 1 — Auto-Approved\n- Internal documents (specs, runbooks, meeting notes)\n- Task status updates\n- Agent-to-agent communications\n\n### Tier 2 — CEO Approval Required\n- Social media posts (all platforms)\n- Blog publications\n- Email campaigns to authors\n- Pricing page changes\n\n### Tier 3 — CEO + Legal Review\n- Partnership announcements\n- Pricing changes\n- Privacy policy updates\n- Manuscript data handling changes\n\n## Content Guidelines\n- Never promise specific outcomes ("guaranteed bestseller")\n- Always position AI as a tool, not a replacement for human editors\n- Respect author privacy — never share manuscript content or report details without explicit consent\n- Use inclusive language; follow Dr. Heaton\'s DEI guidelines\n\n## SLA\n- Tier 2: 4-hour response for social, 24-hour for blog\n- Tier 3: 48-hour minimum review period',
    source: { action_id: null, task_id: null }
  },
  {
    id: 'doc_1709280000004_runbook', title: 'Runbook — Report Dimension Definitions',
    kind: 'runbook', status: 'draft', tags: ['reports', 'reference', 'dimensions'],
    created_by: 'scribe', created_at: daysAgo(20), updated_at: daysAgo(10),
    content_md: '# Report Dimension Definitions\n\nReference guide for all 17 report dimensions available in Story Stream.\n\n---\n\n## Blueprint Tier (Free — 3 Reports)\n\n### 1. Publication Readiness Score\nA 0–100 score reflecting how close the manuscript is to being submission/publication-ready. Factors in structure, pacing, character development, prose quality, and market fit.\n\n### 2. Executive Summary\nA 500-word overview of the manuscript\'s core strengths and areas for improvement. Written in encouraging, constructive language.\n\n### 3. Top-3 Action Items\nThe three highest-impact revisions the author should prioritize, with specific page/chapter references.\n\n---\n\n## First Edition Tier ($99 — 7 Reports)\n*Includes all Blueprint reports, plus:*\n\n### 4. Scene-by-Scene Heat-Map\nVisual breakdown of every scene showing pacing (fast/slow), tension level (1–10), and emotional arc. Color-coded for quick scanning.\n\n### 5. Character Arc Analysis\nDetailed tracking of each major character\'s arc: introduction, development, crisis, resolution. Flags flat or underdeveloped arcs.\n\n### 6. Pacing Graph\nChapter-by-chapter pacing visualization showing where the story accelerates, sags, or rushes.\n\n### 7. Dialogue Assessment\nAnalysis of dialogue patterns: authenticity, character voice distinction, info-dumping, and balance of dialogue vs. narration.\n\n---\n\n## Masterpiece Tier ($199 — 17 Reports)\n*Includes all First Edition reports, plus:*\n\n### 8. Target Market Snapshot\nAI-identified target audience, comparable titles, and market positioning recommendations.\n\n### 9. Comp Title Analysis\nDetailed comparison with 3–5 published titles in the same space, including what works and what differentiates.\n\n### 10. Query Letter Draft\nAI-generated query letter based on the manuscript\'s hook, stakes, and unique angle.\n\n### 11. Chapter-by-Chapter Breakdown\nIndividual feedback for every chapter: purpose, pacing contribution, key moments, and revision suggestions.\n\n### 12. Theme Mapping\nIdentification and tracking of thematic threads throughout the manuscript.\n\n### 13. Sensitivity Flags\nFlags for potentially sensitive content with context and handling suggestions.\n\n### 14. Genre Convention Check\nHow well the manuscript meets reader expectations for its genre (romance, thriller, literary, sci-fi, etc.).\n\n### 15. Opening Hook Analysis\nDetailed assessment of the first chapter/pages — does it hook the reader and agent?\n\n### 16. Ending Impact Score\nEvaluation of the ending\'s emotional resonance, loose threads, and reader satisfaction.\n\n### 17. Revision Roadmap\nPrioritized, step-by-step revision plan from highest to lowest impact changes.',
    source: { action_id: null, task_id: null }
  }
);

// ============================================================
// DAILY LOG + BLOG POSTS
// ============================================================
const dailyLog = [
  {
    id: 'daily-001', date: daysAgo(1).split('T')[0],
    entry: 'Published "Your Manuscript Deserves More Than a Grammar Check" to blog. 3 social posts approved and executed across LinkedIn and X. 12 new Blueprint signups today. Nova reported all agents healthy.',
    status: 'published', createdBy: 'scribe'
  },
  {
    id: 'daily-002', date: daysAgo(2).split('T')[0],
    entry: 'Cipher flagged rising Gemini costs — now $1.20 avg per Masterpiece report (target: $1.00). Echo drafted 2 LinkedIn posts targeting #WritingCommunity. Scout delivered competitive analysis of Sudowrite\'s new features.',
    status: 'published', createdBy: 'scribe'
  },
  {
    id: 'daily-003', date: daysAgo(3).split('T')[0],
    entry: 'Forge resolved .docx parser crash with tracked changes — critical fix for author uploads. Pixel began report layout audit. 8 new First Edition conversions this week, bringing total to 89.',
    status: 'published', createdBy: 'scribe'
  }
];

const blogPosts = [
  {
    id: 'blog-001',
    title: 'Your Manuscript Deserves More Than a Grammar Check',
    slug: 'more-than-grammar-check',
    content: 'You\'ve finished your manuscript. Congratulations — that alone puts you ahead of 95% of people who say they want to write a book.\n\nBut now comes the hard part: figuring out if your story actually works.\n\nGrammarly can fix your commas. ProWritingAid can flag passive voice. But neither can tell you if your second act sags, if your protagonist\'s arc feels earned, or if your pacing loses readers at chapter seven.\n\nThat\'s what developmental editing is for. And until now, it\'s been a $3,000–$5,000 luxury that most indie authors simply couldn\'t afford.\n\nStory Stream changes that. Our AI-powered developmental editing reports give you the structural feedback you need — pacing analysis, character arc tracking, scene-by-scene heat maps, and a publication readiness score — starting completely free with our Blueprint tier.\n\nThis isn\'t about replacing human editors. It\'s about giving every author access to the kind of feedback that used to be reserved for authors with big advances and bigger budgets.',
    publishedAt: daysAgo(7), author: 'Scribe', status: 'published'
  },
  {
    id: 'blog-002',
    title: 'What Is Developmental Editing? A Guide for First-Time Authors',
    slug: 'what-is-developmental-editing',
    content: 'If you\'re querying agents or preparing to self-publish, you\'ve probably heard the term "developmental editing." But what does it actually mean?\n\nDevelopmental editing focuses on the big picture: story structure, character development, pacing, theme, and narrative arc. It\'s the difference between "this sentence has a typo" and "this chapter doesn\'t earn the emotional payoff you\'re going for."\n\nThink of it as an X-ray for your manuscript — it reveals the bones of your story and shows you where the structure is strong and where it needs reinforcement.\n\nMost developmental editors charge $3,000–$5,000, and turnaround takes 4–8 weeks. That\'s a significant investment of both money and time.\n\nStory Stream was built to democratize this process. Using advanced AI analysis, we deliver developmental feedback in under an hour — from a free Publication Readiness Score to a full 17-report Masterpiece package for $199.',
    publishedAt: daysAgo(21), author: 'Scribe', status: 'published'
  }
];

// ============================================================
// SEED ALL
// ============================================================
async function main() {
  console.log('Seeding demo data to: ' + DEMO_API + '\n');

  await seed('identity', identity);
  await seed('agentConfigs', agentConfigs);
  await seed('objectives', objectives);
  await seed('campaigns', campaigns);
  await seed('tasks', tasks);
  await seed('actions', actions);
  await seed('approvalQueue', approvalQueue);
  await seed('actionAuditLog', actionAuditLog);
  await seed('heartbeatRuns', heartbeatRuns);
  await seed('workspaceMemory', workspaceMemory);
  await seed('documents', documents);
  await seed('dailyLog', dailyLog);
  await seed('blogPosts', blogPosts);

  console.log('\nDone! Story Stream demo data seeded.');
}

main().catch(err => { console.error('Seed failed:', err); process.exit(1); });
