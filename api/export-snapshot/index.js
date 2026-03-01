// export-snapshot — POST /api/export-snapshot
// Read-only snapshot of all operational state. No mutations.
// Saves timestamped JSON to blob storage under snapshots/ virtual directory.

const storage = require('../_utils/companyStorage');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'company-state';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal',
  'Content-Type': 'application/json'
};

// Write snapshot blob directly (storage helper sanitizes keys, so we bypass for path-based names)
async function _writeSnapshotBlob(blobName, data) {
  try {
    let blobServiceClient;
    if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
      const { BlobServiceClient } = require('@azure/storage-blob');
      blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
    } else {
      const { BlobServiceClient } = require('@azure/storage-blob');
      const { DefaultAzureCredential } = require('@azure/identity');
      blobServiceClient = new BlobServiceClient(
        `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
        new DefaultAzureCredential()
      );
    }
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    await containerClient.createIfNotExists();
    const blob = containerClient.getBlockBlobClient(blobName);
    const content = JSON.stringify(data, null, 2);
    await blob.upload(content, Buffer.byteLength(content), {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      overwrite: true
    });
    return { ok: true, path: CONTAINER_NAME + '/' + blobName };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Local file fallback for dev
function _writeSnapshotLocal(blobName, data) {
  const path = require('path');
  const fs = require('fs');
  const dir = path.join(__dirname, '..', '_company-data', 'snapshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, blobName.replace('snapshots/', ''));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return { ok: true, path: filePath };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  const ts = new Date().toISOString();
  const safeName = ts.replace(/[:.]/g, '-');
  const blobName = 'snapshots/snapshot-' + safeName + '.json';

  context.log('[ExportSnapshot] Starting snapshot export:', blobName);

  try {
    // Load all operational state (read-only)
    const [
      tasks,
      campaigns,
      objectives,
      runtimeMemory,
      standupLog,
      logs,
      executionMode,
      agentConfigs,
      workspaceMemory,
      approvalQueue,
      governanceLog,
      actionAuditLog
    ] = await Promise.all([
      storage.getState('tasks').catch(function () { return null; }),
      storage.getState('campaigns').catch(function () { return null; }),
      storage.getState('objectives').catch(function () { return null; }),
      storage.getState('runtimeMemory').catch(function () { return null; }),
      storage.getState('standupLog').catch(function () { return null; }),
      storage.getState('logs').catch(function () { return null; }),
      storage.getState('execution_mode').catch(function () { return null; }),
      storage.getState('agentConfigs').catch(function () { return null; }),
      storage.getState('workspaceMemory').catch(function () { return null; }),
      storage.getState('approvalQueue').catch(function () { return null; }),
      storage.getState('governanceLog').catch(function () { return null; }),
      storage.getState('actionAuditLog').catch(function () { return null; })
    ]);

    var goalsArr = Array.isArray(objectives) ? objectives : [];
    var projectsArr = Array.isArray(campaigns) ? campaigns : [];
    var tasksArr = Array.isArray(tasks) ? tasks : [];

    // Build snapshot
    var snapshot = {
      meta: {
        exportedAt: ts,
        version: 'AmbientCore Pre-Launch Snapshot',
        execution_mode: executionMode || 'active'
      },
      goals: goalsArr,
      campaigns: projectsArr,
      projects: projectsArr, // backward compat alias
      tasks: tasksArr,
      runtimeMemory: runtimeMemory || null,
      standups: standupLog || [],
      telemetry: logs || [],
      agentConfigs: agentConfigs || null,
      workspaceMemory: workspaceMemory || null,
      approvalQueue: approvalQueue || [],
      governanceLog: governanceLog || [],
      actionAuditLog: actionAuditLog || []
    };

    // Write snapshot to blob (or local fallback)
    var writeResult;
    if (process.env.AZURE_STORAGE_CONNECTION_STRING || !process.env.AzureWebJobsStorage === undefined) {
      writeResult = await _writeSnapshotBlob(blobName, snapshot);
    } else {
      // Try blob first, fall back to local
      writeResult = await _writeSnapshotBlob(blobName, snapshot);
      if (!writeResult.ok) {
        writeResult = _writeSnapshotLocal(blobName, snapshot);
      }
    }

    if (!writeResult.ok) {
      context.log.error('[ExportSnapshot] Write failed:', writeResult.error);
      context.res = {
        status: 500,
        headers: corsHeaders,
        body: { ok: false, error: 'Snapshot write failed: ' + writeResult.error }
      };
      return;
    }

    // Log telemetry event (non-fatal)
    try {
      await storage.appendLog({
        type: 'snapshot_export',
        timestamp: ts,
        data: {
          exportedAt: ts,
          snapshotFile: writeResult.path,
          goalCount: goalsArr.length,
          projectCount: projectsArr.length,
          taskCount: tasksArr.length
        }
      });
    } catch (_e) { /* non-fatal */ }

    context.log('[ExportSnapshot] Snapshot saved:', writeResult.path,
      '| goals:', goalsArr.length, '| projects:', projectsArr.length, '| tasks:', tasksArr.length);

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        ok: true,
        snapshotFile: writeResult.path,
        counts: {
          goals: goalsArr.length,
          projects: projectsArr.length,
          tasks: tasksArr.length
        }
      }
    };
  } catch (err) {
    context.log.error('[ExportSnapshot] Error:', err.message, err.stack);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { ok: false, error: err.message }
    };
  }
};
