// agent-capabilities.js — Data-driven agent capability definitions (Phase 7)
// Replaces hardcoded if-else branches in agent-runner.js with capability lookups.
// Usage: const caps = AGENT_CAPABILITIES[agentId]; if (caps.canSocialAction) { ... }

const AGENT_CAPABILITIES = {
  nova: {
    tier: 2,
    canCreateTask: true,
    canPropose: ['objective', 'campaign'],
    canDirective: true,
    canLifecycle: true,
    canSocialAction: false,
    canPublish: false,
    canGenerateImage: false,
    canCreateDoc: true,
    canReviewTask: true,
    canExecuteTask: true,
    canWebSearch: false,
    canExperiment: false,
    taskFilterAll: true,         // sees all tasks for triage (not just assigned)
    excludeReviewFromFilter: false,
    socialInjection: false,
    scoutDiscovery: false,
    heroImageNudge: false,
    copyReviewInjection: false,
    canExtractTrendInsights: false,
    canResearchRecursionGuard: false,
    canBlogPublish: false,
    canDelegationCheck: true,    // Nova checks for delegation spam
    canBlueskyReply: false,
    canSocialCopyRoute: false,
    canAutoHeroImage: false,
    skipSocialReviews: false,
    canParentTaskPassthrough: true, // Nova passes parent_task_id on create-task
    canResearchIntelExtract: false,
    socialActionTaskLookup: false,
    canFinanceReport: false,
    excludeFromStallDetection: false
  },
  cipher: {
    tier: 3, canCreateTask: true, canPropose: [], canDirective: false, canLifecycle: false,
    canSocialAction: false, canPublish: false, canGenerateImage: false, canCreateDoc: true,
    canReviewTask: false, canExecuteTask: true, canWebSearch: false, canExperiment: false,
    taskFilterAll: false, excludeReviewFromFilter: false,
    socialInjection: false, scoutDiscovery: false, heroImageNudge: false, copyReviewInjection: false,
    canExtractTrendInsights: false, canResearchRecursionGuard: false, canBlogPublish: false,
    canDelegationCheck: false, canBlueskyReply: false, canSocialCopyRoute: false,
    canAutoHeroImage: false, skipSocialReviews: true, canParentTaskPassthrough: false,
    canResearchIntelExtract: false, socialActionTaskLookup: false,
    canFinanceReport: true, excludeFromStallDetection: false
  },
  pixel: {
    tier: 3, canCreateTask: true, canPropose: [], canDirective: false, canLifecycle: false,
    canSocialAction: false, canPublish: false, canGenerateImage: true, canCreateDoc: false,
    canReviewTask: true, canExecuteTask: true, canWebSearch: false, canExperiment: false,
    taskFilterAll: false, excludeReviewFromFilter: true,
    socialInjection: false, scoutDiscovery: false, heroImageNudge: true, copyReviewInjection: false,
    canExtractTrendInsights: false, canResearchRecursionGuard: false, canBlogPublish: false,
    canDelegationCheck: false, canBlueskyReply: false, canSocialCopyRoute: false,
    canAutoHeroImage: false, skipSocialReviews: true, canParentTaskPassthrough: false,
    canResearchIntelExtract: false, socialActionTaskLookup: false,
    canFinanceReport: false, excludeFromStallDetection: false
  },
  forge: {
    tier: 3, canCreateTask: true, canPropose: [], canDirective: true, canLifecycle: false,
    canSocialAction: false, canPublish: false, canGenerateImage: false, canCreateDoc: true,
    canReviewTask: false, canExecuteTask: true, canWebSearch: false, canExperiment: false,
    taskFilterAll: false, excludeReviewFromFilter: false,
    socialInjection: false, scoutDiscovery: false, heroImageNudge: false, copyReviewInjection: false,
    canExtractTrendInsights: false, canResearchRecursionGuard: false, canBlogPublish: false,
    canDelegationCheck: false, canBlueskyReply: false, canSocialCopyRoute: false,
    canAutoHeroImage: false, skipSocialReviews: true, canParentTaskPassthrough: false,
    canResearchIntelExtract: false, socialActionTaskLookup: false,
    canFinanceReport: false, excludeFromStallDetection: false
  },
  echo: {
    tier: 3, canCreateTask: true, canPropose: ['campaign'], canDirective: false, canLifecycle: false,
    canSocialAction: true, canPublish: false, canGenerateImage: false, canCreateDoc: false,
    canReviewTask: true, canExecuteTask: true, canWebSearch: false, canExperiment: true,
    taskFilterAll: false, excludeReviewFromFilter: false,
    socialInjection: true, scoutDiscovery: false, heroImageNudge: false, copyReviewInjection: false,
    canExtractTrendInsights: false, canResearchRecursionGuard: false, canBlogPublish: false,
    canDelegationCheck: false, canBlueskyReply: false, canSocialCopyRoute: false,
    canAutoHeroImage: false, skipSocialReviews: false, canParentTaskPassthrough: false,
    canResearchIntelExtract: false, socialActionTaskLookup: true,
    canFinanceReport: false, excludeFromStallDetection: false
  },
  scribe: {
    tier: 3, canCreateTask: true, canPropose: [], canDirective: false, canLifecycle: false,
    canSocialAction: false, canPublish: true, canGenerateImage: false, canCreateDoc: true,
    canReviewTask: true, canExecuteTask: true, canWebSearch: false, canExperiment: false,
    taskFilterAll: false, excludeReviewFromFilter: false,
    socialInjection: false, scoutDiscovery: false, heroImageNudge: false, copyReviewInjection: false,
    canExtractTrendInsights: false, canResearchRecursionGuard: false, canBlogPublish: true,
    canDelegationCheck: false, canBlueskyReply: true, canSocialCopyRoute: true,
    canAutoHeroImage: true, skipSocialReviews: false, canParentTaskPassthrough: false,
    canResearchIntelExtract: false, socialActionTaskLookup: false,
    canFinanceReport: false, excludeFromStallDetection: false
  },
  quill: {
    tier: 4, canCreateTask: false, canPropose: [], canDirective: false, canLifecycle: false,
    canSocialAction: false, canPublish: false, canGenerateImage: false, canCreateDoc: false,
    canReviewTask: true, canExecuteTask: true, canWebSearch: false, canExperiment: false,
    taskFilterAll: false, excludeReviewFromFilter: false,
    socialInjection: false, scoutDiscovery: false, heroImageNudge: false, copyReviewInjection: true,
    canExtractTrendInsights: false, canResearchRecursionGuard: false, canBlogPublish: false,
    canDelegationCheck: false, canBlueskyReply: false, canSocialCopyRoute: false,
    canAutoHeroImage: false, skipSocialReviews: false, canParentTaskPassthrough: false,
    canResearchIntelExtract: false, socialActionTaskLookup: false,
    canFinanceReport: false, excludeFromStallDetection: true
  },
  scout: {
    tier: 3, canCreateTask: true, canPropose: [], canDirective: false, canLifecycle: false,
    canSocialAction: false, canPublish: false, canGenerateImage: false, canCreateDoc: true,
    canReviewTask: false, canExecuteTask: true, canWebSearch: true, canExperiment: false,
    taskFilterAll: false, excludeReviewFromFilter: false,
    socialInjection: false, scoutDiscovery: true, heroImageNudge: false, copyReviewInjection: false,
    canExtractTrendInsights: true, canResearchRecursionGuard: true, canBlogPublish: false,
    canDelegationCheck: false, canBlueskyReply: false, canSocialCopyRoute: false,
    canAutoHeroImage: false, skipSocialReviews: true, canParentTaskPassthrough: false,
    canResearchIntelExtract: true, socialActionTaskLookup: false,
    canFinanceReport: false, excludeFromStallDetection: false
  }
};

module.exports = { AGENT_CAPABILITIES };
