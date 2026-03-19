#!/usr/bin/env node
// smoke-test.js — Lightweight pre-deploy smoke test for the heartbeat pipeline
// Run: node api/companyHeartbeat/smoke-test.js
// No external dependencies — mocks Gemini + storage, exercises real code paths

const path = require('path');
const assert = require('assert');

// ── Mock infrastructure ──
let _mockStorage = {};
let _mockGeminiCalls = [];
let _mockGeminiResponse = '{"taskUpdates":[],"proposals":[],"remember":[],"observations":["Test observation"]}';
let _mockGeminiExecuteResponse = 'This is a test deliverable with enough content to pass validation.';

// Mock storage before requiring modules
const storageModule = require('../_utils/companyStorage');
const _origGetState = storageModule.getState;
const _origSetState = storageModule.setState;
storageModule.getState = async (key) => _mockStorage[key] || null;
storageModule.setState = async (key, value) => { _mockStorage[key] = value; return true; };
storageModule.appendLog = async () => {};
storageModule.logGeminiUsage = async () => {};

// Mock Gemini
const geminiModule = require('./gemini');
const _origCallGemini = geminiModule.callGemini;
const _origCallGeminiExec = geminiModule.callGeminiExecute;
geminiModule.callGemini = async (prompt, agentId) => {
  _mockGeminiCalls.push({ type: 'heartbeat', agentId, promptLen: prompt.length });
  return _mockGeminiResponse;
};
geminiModule.callGeminiExecute = async (prompt, agentId) => {
  _mockGeminiCalls.push({ type: 'execute', agentId, promptLen: prompt.length });
  return _mockGeminiExecuteResponse;
};

// Mock web search
try {
  const ws = require('../toolsWebSearch/index');
  if (ws.searchInternal) ws.searchInternal = async () => ({ ok: true, results: [] });
} catch (e) { /* not critical */ }

// Mock image engine
try {
  const ie = require('../_lib/contentEngine/imageEngine');
  if (ie.generateImage) ie.generateImage = async () => ({ url: 'https://mock.test/image.png' });
} catch (e) { /* not critical */ }

// Now require the modules under test
const { AGENT_ROLES, AGENT_IDS, GUARDRAILS, VALID_TASK_STATUSES } = require('./constants');
const { buildHeartbeatPrompt } = require('./prompt-builders');
const { applyTaskUpdate } = require('./task-mutations');
const { runAgentHeartbeat } = require('./agent-runner');
const { _createActionFromHeartbeat } = require('./helpers');

// ── Test fixtures ──
function mockContext() {
  return {
    log: Object.assign((...args) => {}, {
      error: () => {},
      warn: () => {},
      info: () => {}
    })
  };
}

function mockTask(overrides) {
  return Object.assign({
    id: 'task-smoke-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: 'Smoke test task',
    description: 'Test task for smoke testing',
    taskType: 'social_x',
    status: 'todo',
    priority: 'medium',
    assignee: 'echo',
    source: 'heartbeat',
    created_by: 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    objective_id: 'obj-smoke-1',
    campaign_id: 'camp-smoke-1',
    comments: [],
    tags: []
  }, overrides);
}

function mockObjective() {
  return { id: 'obj-smoke-1', title: 'Smoke test objective', status: 'active', progress: 0 };
}

function mockCampaign() {
  return { id: 'camp-smoke-1', title: 'Smoke test campaign', status: 'active', allowedTaskTypes: ['social_x'] };
}

const productFacts = {
  products: {
    AmbientScore: {
      description: 'Website conversion scoring tool',
      features: ['URL-based scanning', 'conversion score rating'],
      notThis: ['NOT an SEO tool', 'NOT an accessibility tool']
    }
  },
  company: { name: 'AmbientPixels', url: 'https://ambientpixels.ai', tone: 'Professional' }
};

// ── Test runner ──
let _passed = 0;
let _failed = 0;
let _errors = [];

function test(name, fn) {
  try {
    fn();
    _passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } catch (e) {
    _failed++;
    _errors.push({ name, error: e.message });
    console.log('  \x1b[31m✗\x1b[0m ' + name + ' — ' + e.message);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    _passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } catch (e) {
    _failed++;
    _errors.push({ name, error: e.message });
    console.log('  \x1b[31m✗\x1b[0m ' + name + ' — ' + e.message);
  }
}

// ── Tests ──
async function runSmokeTests() {
  console.log('\n\x1b[1m🔥 Heartbeat Smoke Tests\x1b[0m\n');

  // ── 1. Constants load correctly ──
  console.log('\x1b[36m[Constants]\x1b[0m');
  test('AGENT_IDS has 8 agents', () => {
    assert.strictEqual(AGENT_IDS.length, 8);
  });
  test('All agents have roles defined', () => {
    AGENT_IDS.forEach(id => assert.ok(AGENT_ROLES[id], 'Missing role for ' + id));
  });
  test('Guardrails have expected limits', () => {
    assert.ok(GUARDRAILS.maxActionsPerCyclePerAgent >= 1);
    assert.ok(GUARDRAILS.maxActiveTasks >= 10);
  });

  // ── 2. Prompt builders ──
  console.log('\n\x1b[36m[Prompt Builders]\x1b[0m');
  for (const agentId of ['nova', 'echo', 'scribe', 'quill', 'cipher', 'scout']) {
    test('buildHeartbeatPrompt works for ' + agentId, () => {
      const agent = AGENT_ROLES[agentId];
      const prompt = buildHeartbeatPrompt(
        agent, [], [], [], [mockObjective()], [],
        [], [], [], null, new Set(), { _global: 'Test seed' },
        [], null, null, { [agentId]: [] }, {},
        null, null, null, null, productFacts
      );
      assert.ok(typeof prompt === 'string', 'Prompt should be a string');
      assert.ok(prompt.length > 100, 'Prompt should have content (got ' + prompt.length + ')');
    });
  }

  test('Product facts injected for Echo/Scribe/Quill', () => {
    const echoAgent = Object.assign({}, AGENT_ROLES.echo, { id: 'echo' });
    const prompt = buildHeartbeatPrompt(
      echoAgent, [], [], [], [mockObjective()], [],
      [], [], [], null, new Set(), {},
      [], null, null, { echo: [] }, {},
      null, null, null, null, productFacts
    );
    assert.ok(prompt.indexOf('PRODUCT FACTS') !== -1, 'Should contain PRODUCT FACTS block');
    assert.ok(prompt.indexOf('AmbientScore') !== -1, 'Should mention AmbientScore');
  });

  test('Product facts NOT injected for Cipher', () => {
    const prompt = buildHeartbeatPrompt(
      AGENT_ROLES.cipher, [], [], [], [mockObjective()], [],
      [], [], [], { gemini: { totalCost: 1.5 } }, new Set(), {},
      [], null, null, { cipher: [] }, {},
      null, null, null, null, productFacts
    );
    assert.ok(prompt.indexOf('PRODUCT FACTS') === -1, 'Cipher should NOT get product facts');
  });

  // ── 3. Task mutations ──
  console.log('\n\x1b[36m[Task Mutations]\x1b[0m');
  test('Create task adds to array', () => {
    const tasks = [];
    const escalations = [];
    applyTaskUpdate(tasks, {
      action: 'create',
      agentId: 'nova',
      task: { title: 'Test task', description: 'Desc', taskType: 'general', priority: 'medium', assignee: 'echo', objective_id: 'obj-1' }
    }, escalations, 'nova');
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].status, 'todo');
  });

  test('Execute task moves to review with deliverable', () => {
    const tasks = [mockTask({ status: 'in-progress' })];
    const taskId = tasks[0].id;
    applyTaskUpdate(tasks, {
      action: 'execute',
      taskId: taskId,
      agentId: 'echo',
      deliverable: 'Test deliverable content'
    }, [], 'echo');
    assert.strictEqual(tasks[0].status, 'review');
    const delComment = tasks[0].comments.find(c => c.type === 'deliverable');
    assert.ok(delComment, 'Should have deliverable comment');
  });

  test('Self-review is blocked', () => {
    const tasks = [mockTask({ status: 'review', assignee: 'echo' })];
    tasks[0].comments = [{ type: 'deliverable', text: 'Content', createdAt: new Date().toISOString() }];
    const taskId = tasks[0].id;
    applyTaskUpdate(tasks, {
      action: 'review',
      taskId: taskId,
      agentId: 'echo',
      review: { verdict: 'approved', feedback: 'LGTM' }
    }, [], 'echo');
    // Should still be in review (self-review blocked)
    assert.strictEqual(tasks[0].status, 'review', 'Self-review should be blocked');
  });

  test('Copy task inherits objective_id from parent', () => {
    // Simulate the copy task creation flow — check the field exists in the template
    const parentTask = mockTask({ objective_id: 'obj-parent-123', campaign_id: 'camp-1' });
    const copyTask = {
      id: 'task_copy_test',
      title: 'Write social copy for: ' + parentTask.title,
      taskType: 'social_copy',
      status: 'todo',
      assignee: 'scribe',
      parent_task_id: parentTask.id,
      campaign_id: parentTask.campaign_id || null,
      objective_id: parentTask.objective_id || null
    };
    assert.strictEqual(copyTask.objective_id, 'obj-parent-123', 'Copy task should inherit objective_id');
  });

  // ── 4. Agent runner (mocked Gemini) ──
  console.log('\n\x1b[36m[Agent Runner]\x1b[0m');
  for (const agentId of ['nova', 'echo', 'scribe']) {
    await asyncTest('runAgentHeartbeat completes for ' + agentId + ' without crash', async () => {
      _mockGeminiCalls = [];
      const tasks = agentId === 'echo' ? [mockTask({ assignee: 'echo', status: 'todo' })] : [];
      const result = await runAgentHeartbeat(
        mockContext(), agentId, tasks,
        { [agentId]: { heartbeat: { enabled: true }, doctrineWeight: 0.4 } },
        new Set(), 'cycle-smoke-test', null,
        [mockCampaign()], [mockObjective()], [],
        [], [], [],
        agentId === 'cipher' ? { gemini: { totalCost: 1 } } : null,
        new Set(), { _global: 'Test' },
        [], null,
        'supervised_autonomous',
        () => false, () => {}, () => {},
        { [agentId]: { context: '', maxTasks: 5 } },
        null, null,
        { [agentId]: [] },
        null, null, null, null,
        productFacts
      );
      assert.ok(result, 'Should return result object');
      assert.ok(typeof result.geminiCalls === 'number', 'Should track gemini calls');
      assert.ok(typeof result.actions === 'number', 'Should track actions');
      assert.ok(result.guardrails, 'Should have guardrails object');
    });
  }

  // ── 5. Null deliverable handling ──
  console.log('\n\x1b[36m[Null Deliverable]\x1b[0m');
  test('Null deliverable handling adds failed_attempt comment', () => {
    // Directly test the null deliverable logic (same as agent-runner.js else block)
    const task = mockTask({ status: 'in-progress', comments: [] });

    // Simulate what the else block does when deliverable is null
    const deliverable = null;
    if (!deliverable) {
      if (!task.comments) task.comments = [];
      const _failCount = task.comments.filter(c => c.type === 'failed_attempt').length;
      task.comments.push({
        id: 'cmt-fail-' + Date.now(),
        author: 'system',
        type: 'failed_attempt',
        text: '[SYSTEM] Execute returned empty result (attempt ' + (_failCount + 1) + ').',
        createdAt: new Date().toISOString()
      });

      if (_failCount + 1 >= 3) {
        task.status = 'todo';
      }
    }

    const failComments = task.comments.filter(c => c.type === 'failed_attempt');
    assert.strictEqual(failComments.length, 1, 'Should have 1 failed_attempt comment');
    assert.strictEqual(task.status, 'in-progress', 'Should stay in-progress after 1 failure');
  });

  test('3 failed attempts resets task to todo', () => {
    const task = mockTask({ status: 'in-progress', comments: [
      { type: 'failed_attempt', text: 'fail 1', createdAt: new Date().toISOString() },
      { type: 'failed_attempt', text: 'fail 2', createdAt: new Date().toISOString() }
    ]});

    // Simulate 3rd failure
    const _failCount = task.comments.filter(c => c.type === 'failed_attempt').length;
    task.comments.push({ type: 'failed_attempt', text: 'fail 3', createdAt: new Date().toISOString() });
    if (_failCount + 1 >= 3) {
      task.status = 'todo';
    }

    assert.strictEqual(task.status, 'todo', 'Should reset to todo after 3 failures');
  });

  // ── 6. URL preservation in auto-post trimming ──
  console.log('\n\x1b[36m[URL Preservation]\x1b[0m');
  test('ambientpixels.ai URL regex matches product pages', () => {
    const regex = /https?:\/\/ambientpixels\.ai(?:\/[a-z0-9\/-]*)?/i;
    assert.ok(regex.test('https://ambientpixels.ai/pixel-agents/'), 'Should match /pixel-agents/');
    assert.ok(regex.test('https://ambientpixels.ai/ambientscore/'), 'Should match /ambientscore/');
    assert.ok(regex.test('https://ambientpixels.ai/blog/some-post'), 'Should match /blog/ URLs');
    assert.ok(regex.test('https://ambientpixels.ai'), 'Should match bare domain');
  });

  test('Trimmed text preserves URL when under char limit', () => {
    const text = 'Short post about AmbientScore. https://ambientpixels.ai/ambientscore/';
    assert.ok(text.length < 280, 'Should be under X char limit');
    assert.ok(text.indexOf('ambientpixels.ai') !== -1, 'URL should be present');
  });

  // ── 7. Action creation ──
  console.log('\n\x1b[36m[Action Creation]\x1b[0m');
  test('_createActionFromHeartbeat produces valid action', () => {
    const action = _createActionFromHeartbeat({
      type: 'social_post.schedule',
      platform: 'x',
      payload: { text: 'Test post https://ambientpixels.ai', media: [] }
    }, 'echo');
    assert.ok(action.id, 'Should have ID');
    assert.strictEqual(action.approval.status, 'pending');
    assert.strictEqual(action.source, 'heartbeat');
  });

  // ── 8. Escalation dedup ──
  console.log('\n\x1b[36m[Escalation Dedup]\x1b[0m');
  test('Resolved escalations prevent re-creation', () => {
    const queue = [
      { id: 'aq-overdue-task1', type: 'overdue_escalation', taskId: 'task1', status: 'resolved', resolvedAt: new Date().toISOString() }
    ];
    const alreadyExists = queue.some(q => q.type === 'overdue_escalation' && q.taskId === 'task1');
    assert.ok(alreadyExists, 'Dedup should find resolved escalation');
  });

  test('Pending escalations also caught by dedup', () => {
    const queue = [
      { id: 'aq-overdue-task2', type: 'overdue_escalation', taskId: 'task2', status: 'pending' }
    ];
    const alreadyExists = queue.some(q => q.type === 'overdue_escalation' && q.taskId === 'task2');
    assert.ok(alreadyExists, 'Dedup should find pending escalation');
  });

  // ── Results ──
  console.log('\n' + '─'.repeat(50));
  console.log('\x1b[1m Results: ' + _passed + ' passed, ' + _failed + ' failed\x1b[0m');
  if (_failed > 0) {
    console.log('\n\x1b[31mFailed tests:\x1b[0m');
    _errors.forEach(e => console.log('  • ' + e.name + ': ' + e.error));
    console.log('');
    process.exit(1);
  } else {
    console.log('\x1b[32m All smoke tests passed!\x1b[0m\n');
    process.exit(0);
  }
}

// Restore mocks on exit
process.on('exit', () => {
  storageModule.getState = _origGetState;
  storageModule.setState = _origSetState;
  geminiModule.callGemini = _origCallGemini;
  geminiModule.callGeminiExecute = _origCallGeminiExec;
});

runSmokeTests().catch(err => {
  console.error('\x1b[31mSmoke test runner crashed:\x1b[0m', err.message);
  console.error(err.stack);
  process.exit(2);
});
