// agent-capabilities.js — Data-driven agent capability definitions (Phase 7)
// Replaces hardcoded if-else branches in agent-runner.js with capability lookups.
// Usage: const caps = AGENT_CAPABILITIES[agentId]; if (caps.canSocialAction) { ... }

const AGENT_CAPABILITIES = {
  nova: {
    tier: 2,
    canCreateTask: true,
    canPropose: ['objective', 'campaign'],
    canDirective: true,
    canLifecycle: true,          // pause/resume/complete/archive campaigns+objectives
    canSocialAction: false,
    canPublish: false,
    canGenerateImage: false,
    canCreateDoc: true,
    canReviewTask: true,
    canExecuteTask: true,
    canWebSearch: false,
    canExperiment: false,
    taskFilter: 'all',           // Nova sees all tasks for triage
    socialInjection: false,      // Echo-only: inject social actions for done tasks
    scoutDiscovery: false,       // Scout-only: autonomous Bluesky discovery
    heroImageNudge: false,       // Pixel-only: force hero image generation
    copyReviewInjection: false   // Quill-only: inject review for social-copy tasks
  },
  cipher: {
    tier: 3,
    canCreateTask: true,
    canPropose: [],
    canDirective: false,
    canLifecycle: false,
    canSocialAction: false,
    canPublish: false,
    canGenerateImage: false,
    canCreateDoc: true,          // spec docs (financial reports)
    canReviewTask: false,
    canExecuteTask: true,
    canWebSearch: false,
    canExperiment: false,
    taskFilter: 'assigned',
    socialInjection: false,
    scoutDiscovery: false,
    heroImageNudge: false,
    copyReviewInjection: false
  },
  pixel: {
    tier: 3,
    canCreateTask: true,         // design_asset tasks
    canPropose: [],
    canDirective: false,
    canLifecycle: false,
    canSocialAction: false,
    canPublish: false,
    canGenerateImage: true,
    canCreateDoc: false,
    canReviewTask: true,
    canExecuteTask: true,
    canWebSearch: false,
    canExperiment: false,
    taskFilter: 'assigned',
    socialInjection: false,
    scoutDiscovery: false,
    heroImageNudge: true,
    copyReviewInjection: false
  },
  forge: {
    tier: 3,
    canCreateTask: true,         // ops, ops_breakfix, system_directive
    canPropose: [],
    canDirective: true,
    canLifecycle: false,
    canSocialAction: false,
    canPublish: false,
    canGenerateImage: false,
    canCreateDoc: true,          // runbooks
    canReviewTask: false,
    canExecuteTask: true,
    canWebSearch: false,
    canExperiment: false,
    taskFilter: 'assigned',
    socialInjection: false,
    scoutDiscovery: false,
    heroImageNudge: false,
    copyReviewInjection: false
  },
  echo: {
    tier: 3,
    canCreateTask: true,
    canPropose: ['campaign'],
    canDirective: false,
    canLifecycle: false,
    canSocialAction: true,       // only Echo can create social actions
    canPublish: false,
    canGenerateImage: false,
    canCreateDoc: false,
    canReviewTask: true,
    canExecuteTask: true,
    canWebSearch: false,
    canExperiment: true,
    taskFilter: 'assigned',
    socialInjection: true,       // inject social actions for done tasks
    scoutDiscovery: false,
    heroImageNudge: false,
    copyReviewInjection: false
  },
  scribe: {
    tier: 3,
    canCreateTask: true,
    canPropose: [],
    canDirective: false,
    canLifecycle: false,
    canSocialAction: false,
    canPublish: true,
    canGenerateImage: false,
    canCreateDoc: true,
    canReviewTask: true,
    canExecuteTask: true,
    canWebSearch: false,
    canExperiment: false,
    taskFilter: 'assigned',
    socialInjection: false,
    scoutDiscovery: false,
    heroImageNudge: false,
    copyReviewInjection: false
  },
  quill: {
    tier: 4,
    canCreateTask: false,        // Tier 4: no task creation
    canPropose: [],
    canDirective: false,
    canLifecycle: false,
    canSocialAction: false,
    canPublish: false,
    canGenerateImage: false,
    canCreateDoc: false,
    canReviewTask: true,
    canExecuteTask: true,
    canWebSearch: false,
    canExperiment: false,
    taskFilter: 'assigned',
    socialInjection: false,
    scoutDiscovery: false,
    heroImageNudge: false,
    copyReviewInjection: true    // inject review for social-copy tasks
  },
  scout: {
    tier: 3,
    canCreateTask: true,
    canPropose: [],
    canDirective: false,
    canLifecycle: false,
    canSocialAction: false,
    canPublish: false,
    canGenerateImage: false,
    canCreateDoc: true,
    canReviewTask: false,
    canExecuteTask: true,
    canWebSearch: true,
    canExperiment: false,
    taskFilter: 'assigned',
    socialInjection: false,
    scoutDiscovery: true,        // autonomous Bluesky discovery
    heroImageNudge: false,
    copyReviewInjection: false
  }
};

module.exports = { AGENT_CAPABILITIES };
