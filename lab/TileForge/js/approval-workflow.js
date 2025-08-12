/**
 * Approval Workflow - Manages mapping configuration reviews and approvals
 * Provides change tracking, comments, and approval gates for Headliner Crafter
 */

class ApprovalWorkflow {
  constructor() {
    this.approvals = new Map(); // Store approval requests
    this.history = []; // Change history
    this.currentUser = 'User'; // Default user, can be configured
    
    this.approvalStates = {
      DRAFT: 'draft',
      PENDING: 'pending',
      APPROVED: 'approved',
      REJECTED: 'rejected',
      CHANGES_REQUESTED: 'changes_requested'
    };
    
    this.changeTypes = {
      MAPPING_RULE: 'mapping_rule',
      LOCALE_OVERRIDE: 'locale_override',
      GLOBAL_SETTING: 'global_setting',
      CONDITION_LOGIC: 'condition_logic'
    };
  }

  /**
   * Create a new approval request for mapping changes
   * @param {Object} mappingConfig - New mapping configuration
   * @param {Object} previousConfig - Previous configuration for comparison
   * @param {String} description - Description of changes
   * @returns {String} Approval request ID
   */
  createApprovalRequest(mappingConfig, previousConfig, description) {
    const requestId = this.generateRequestId();
    const timestamp = new Date().toISOString();
    
    const changes = this.analyzeChanges(mappingConfig, previousConfig);
    const impact = this.calculateImpact(changes, mappingConfig);
    
    const approvalRequest = {
      id: requestId,
      status: this.approvalStates.PENDING,
      creator: this.currentUser,
      created: timestamp,
      description: description,
      mappingConfig: JSON.parse(JSON.stringify(mappingConfig)), // Deep copy
      previousConfig: JSON.parse(JSON.stringify(previousConfig)),
      changes: changes,
      impact: impact,
      comments: [],
      reviewer: null,
      reviewedAt: null,
      approvedAt: null
    };
    
    this.approvals.set(requestId, approvalRequest);
    
    console.log(`📋 Created approval request ${requestId}: ${description}`);
    console.log(`📊 Impact: ${impact.affectedLocales} locales, ${impact.affectedFields} fields`);
    
    return requestId;
  }

  /**
   * Analyze changes between configurations
   * @param {Object} newConfig - New configuration
   * @param {Object} oldConfig - Previous configuration
   * @returns {Array} Array of change objects
   */
  analyzeChanges(newConfig, oldConfig) {
    const changes = [];
    
    // Compare mapping rules
    if (JSON.stringify(newConfig.rules) !== JSON.stringify(oldConfig.rules)) {
      changes.push({
        type: this.changeTypes.MAPPING_RULE,
        description: 'Mapping rules modified',
        oldValue: oldConfig.rules,
        newValue: newConfig.rules,
        severity: 'high'
      });
    }
    
    // Compare locale overrides
    if (JSON.stringify(newConfig.localeOverrides) !== JSON.stringify(oldConfig.localeOverrides)) {
      changes.push({
        type: this.changeTypes.LOCALE_OVERRIDE,
        description: 'Locale-specific overrides changed',
        oldValue: oldConfig.localeOverrides,
        newValue: newConfig.localeOverrides,
        severity: 'medium'
      });
    }
    
    // Compare global settings
    if (JSON.stringify(newConfig.globalSettings) !== JSON.stringify(oldConfig.globalSettings)) {
      changes.push({
        type: this.changeTypes.GLOBAL_SETTING,
        description: 'Global settings updated',
        oldValue: oldConfig.globalSettings,
        newValue: newConfig.globalSettings,
        severity: 'low'
      });
    }
    
    return changes;
  }

  /**
   * Calculate the impact of proposed changes
   * @param {Array} changes - Array of changes
   * @param {Object} mappingConfig - New mapping configuration
   * @returns {Object} Impact analysis
   */
  calculateImpact(changes, mappingConfig) {
    const impact = {
      affectedLocales: 0,
      affectedFields: [],
      riskLevel: 'low',
      estimatedRows: 0,
      warnings: []
    };
    
    // Analyze each change type
    changes.forEach(change => {
      switch (change.type) {
        case this.changeTypes.MAPPING_RULE:
          impact.affectedFields = ['headline', 'subheadline', 'narrator'];
          impact.riskLevel = 'high';
          impact.warnings.push('Mapping rule changes affect all output');
          break;
          
        case this.changeTypes.LOCALE_OVERRIDE:
          const overrides = Object.keys(change.newValue || {});
          impact.affectedLocales = overrides.length;
          impact.riskLevel = impact.riskLevel === 'high' ? 'high' : 'medium';
          break;
          
        case this.changeTypes.GLOBAL_SETTING:
          if (change.newValue?.enableSmartTruncation !== change.oldValue?.enableSmartTruncation) {
            impact.warnings.push('Smart truncation setting changed');
          }
          break;
      }
    });
    
    return impact;
  }

  /**
   * Add a comment to an approval request
   * @param {String} requestId - Approval request ID
   * @param {String} comment - Comment text
   * @param {String} author - Comment author
   * @returns {Boolean} Success status
   */
  addComment(requestId, comment, author = this.currentUser) {
    const approval = this.approvals.get(requestId);
    if (!approval) {
      console.error(`❌ Approval request ${requestId} not found`);
      return false;
    }
    
    const commentObj = {
      id: this.generateCommentId(),
      author: author,
      text: comment,
      timestamp: new Date().toISOString()
    };
    
    approval.comments.push(commentObj);
    
    console.log(`💬 Comment added to ${requestId} by ${author}`);
    return true;
  }

  /**
   * Approve a mapping configuration
   * @param {String} requestId - Approval request ID
   * @param {String} reviewer - Reviewer name
   * @param {String} comment - Optional approval comment
   * @returns {Boolean} Success status
   */
  approve(requestId, reviewer = 'Reviewer', comment = '') {
    const approval = this.approvals.get(requestId);
    if (!approval) {
      console.error(`❌ Approval request ${requestId} not found`);
      return false;
    }
    
    if (approval.status !== this.approvalStates.PENDING) {
      console.error(`❌ Cannot approve request ${requestId} - status is ${approval.status}`);
      return false;
    }
    
    approval.status = this.approvalStates.APPROVED;
    approval.reviewer = reviewer;
    approval.reviewedAt = new Date().toISOString();
    approval.approvedAt = new Date().toISOString();
    
    if (comment) {
      this.addComment(requestId, comment, reviewer);
    }
    
    // Add to history
    this.addToHistory({
      action: 'approved',
      requestId: requestId,
      reviewer: reviewer,
      timestamp: approval.approvedAt,
      description: approval.description
    });
    
    console.log(`✅ Approval request ${requestId} approved by ${reviewer}`);
    
    // Apply the configuration
    this.applyApprovedConfiguration(requestId);
    
    return true;
  }

  /**
   * Reject a mapping configuration
   * @param {String} requestId - Approval request ID
   * @param {String} reviewer - Reviewer name
   * @param {String} reason - Rejection reason
   * @returns {Boolean} Success status
   */
  reject(requestId, reviewer = 'Reviewer', reason = '') {
    const approval = this.approvals.get(requestId);
    if (!approval) {
      console.error(`❌ Approval request ${requestId} not found`);
      return false;
    }
    
    if (approval.status !== this.approvalStates.PENDING) {
      console.error(`❌ Cannot reject request ${requestId} - status is ${approval.status}`);
      return false;
    }
    
    approval.status = this.approvalStates.REJECTED;
    approval.reviewer = reviewer;
    approval.reviewedAt = new Date().toISOString();
    
    if (reason) {
      this.addComment(requestId, `Rejected: ${reason}`, reviewer);
    }
    
    // Add to history
    this.addToHistory({
      action: 'rejected',
      requestId: requestId,
      reviewer: reviewer,
      timestamp: approval.reviewedAt,
      description: approval.description,
      reason: reason
    });
    
    console.log(`❌ Approval request ${requestId} rejected by ${reviewer}`);
    return true;
  }

  /**
   * Request changes to a mapping configuration
   * @param {String} requestId - Approval request ID
   * @param {String} reviewer - Reviewer name
   * @param {String} feedback - Change requests
   * @returns {Boolean} Success status
   */
  requestChanges(requestId, reviewer = 'Reviewer', feedback = '') {
    const approval = this.approvals.get(requestId);
    if (!approval) {
      console.error(`❌ Approval request ${requestId} not found`);
      return false;
    }
    
    approval.status = this.approvalStates.CHANGES_REQUESTED;
    approval.reviewer = reviewer;
    approval.reviewedAt = new Date().toISOString();
    
    if (feedback) {
      this.addComment(requestId, `Changes requested: ${feedback}`, reviewer);
    }
    
    console.log(`🔄 Changes requested for ${requestId} by ${reviewer}`);
    return true;
  }

  /**
   * Apply an approved configuration to the Headliner Crafter
   * @param {String} requestId - Approval request ID
   * @returns {Boolean} Success status
   */
  applyApprovedConfiguration(requestId) {
    const approval = this.approvals.get(requestId);
    if (!approval || approval.status !== this.approvalStates.APPROVED) {
      console.error(`❌ Cannot apply configuration - request not approved`);
      return false;
    }
    
    try {
      // Apply to HeadlinerCrafter instance
      if (window.headlinerCrafter) {
        window.headlinerCrafter.updateMapping(approval.mappingConfig);
        console.log(`✅ Applied approved configuration ${requestId}`);
        
        // Trigger UI update if available
        if (window.mappingModal && window.mappingModal.refreshPreview) {
          window.mappingModal.refreshPreview();
        }
        
        return true;
      } else {
        console.error(`❌ HeadlinerCrafter instance not available`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Error applying configuration:`, error);
      return false;
    }
  }

  /**
   * Get all pending approval requests
   * @returns {Array} Array of pending approvals
   */
  getPendingApprovals() {
    return Array.from(this.approvals.values())
      .filter(approval => approval.status === this.approvalStates.PENDING)
      .sort((a, b) => new Date(b.created) - new Date(a.created));
  }

  /**
   * Get approval request by ID
   * @param {String} requestId - Request ID
   * @returns {Object|null} Approval request or null
   */
  getApproval(requestId) {
    return this.approvals.get(requestId) || null;
  }

  /**
   * Get approval history
   * @param {Number} limit - Maximum number of entries to return
   * @returns {Array} History entries
   */
  getHistory(limit = 50) {
    return this.history
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Add entry to history
   * @param {Object} entry - History entry
   */
  addToHistory(entry) {
    this.history.push(entry);
    
    // Keep history manageable
    if (this.history.length > 1000) {
      this.history = this.history.slice(-500);
    }
  }

  /**
   * Generate unique request ID
   * @returns {String} Unique ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique comment ID
   * @returns {String} Unique ID
   */
  generateCommentId() {
    return `comment_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * Export approval data for backup/audit
   * @returns {Object} Exportable approval data
   */
  exportApprovalData() {
    return {
      approvals: Array.from(this.approvals.entries()),
      history: this.history,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import approval data from backup
   * @param {Object} data - Approval data to import
   * @returns {Boolean} Success status
   */
  importApprovalData(data) {
    try {
      if (data.approvals) {
        this.approvals = new Map(data.approvals);
      }
      if (data.history) {
        this.history = data.history;
      }
      
      console.log(`✅ Imported approval data from ${data.exportedAt}`);
      return true;
    } catch (error) {
      console.error(`❌ Error importing approval data:`, error);
      return false;
    }
  }

  /**
   * Get approval statistics
   * @returns {Object} Statistics summary
   */
  getStatistics() {
    const approvals = Array.from(this.approvals.values());
    
    return {
      total: approvals.length,
      pending: approvals.filter(a => a.status === this.approvalStates.PENDING).length,
      approved: approvals.filter(a => a.status === this.approvalStates.APPROVED).length,
      rejected: approvals.filter(a => a.status === this.approvalStates.REJECTED).length,
      changesRequested: approvals.filter(a => a.status === this.approvalStates.CHANGES_REQUESTED).length,
      avgApprovalTime: this.calculateAverageApprovalTime(approvals)
    };
  }

  /**
   * Calculate average approval time
   * @param {Array} approvals - Array of approval objects
   * @returns {Number} Average time in hours
   */
  calculateAverageApprovalTime(approvals) {
    const completed = approvals.filter(a => a.approvedAt && a.created);
    
    if (completed.length === 0) return 0;
    
    const totalTime = completed.reduce((sum, approval) => {
      const created = new Date(approval.created);
      const approved = new Date(approval.approvedAt);
      return sum + (approved - created);
    }, 0);
    
    return Math.round((totalTime / completed.length) / (1000 * 60 * 60)); // Convert to hours
  }
}

// Global instance
window.ApprovalWorkflow = ApprovalWorkflow;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  if (!window.approvalWorkflow) {
    window.approvalWorkflow = new ApprovalWorkflow();
    console.log('🔐 Approval Workflow initialized');
  }
});
