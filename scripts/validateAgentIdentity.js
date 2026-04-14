#!/usr/bin/env node
// validateAgentIdentity.js — audits the Identity System for drift.
//
// Compares three sources of agent identity:
//   1. ambientpixels/data/company-agents.json         (canonical — personality, description, title, systemPrompt)
//   2. ambientpixels/api/companyHeartbeat/constants.js AGENT_ROLES  (role string used in "You are X, ROLE at..." prompt header)
//   3. Runtime agentConfigs state                     (CEO overrides applied at heartbeat time)
//
// Flags drift across all three. Run with --live to fetch agentConfigs from Azure;
// otherwise just compares the two static sources.
//
// Usage:
//   node scripts/validateAgentIdentity.js
//   node scripts/validateAgentIdentity.js --live
//   node scripts/validateAgentIdentity.js --json        (machine-readable output)

var fs = require('fs');
var path = require('path');
var https = require('https');

var AGENTS_JSON = path.resolve(__dirname, '..', 'data', 'company-agents.json');
var CONSTANTS_JS = path.resolve(__dirname, '..', 'api', 'companyHeartbeat', 'constants.js');

var API_BASE = 'ambientpixels-nova-api.azurewebsites.net';
var API_SECRET = 'pixelpusher';

var args = process.argv.slice(2);
var LIVE = args.indexOf('--live') !== -1;
var JSON_OUT = args.indexOf('--json') !== -1;

function log() {
  if (!JSON_OUT) console.log.apply(console, arguments);
}

function loadCanonical() {
  var raw = JSON.parse(fs.readFileSync(AGENTS_JSON, 'utf8'));
  var byId = {};
  (raw.agents || []).forEach(function (a) {
    if (!a.isHuman) byId[a.id] = a;
  });
  return byId;
}

function loadConstants() {
  // Extract the AGENT_ROLES object by eval'ing a slice of constants.js.
  // Brittle-ish but simpler than requiring the full module (which reads other files).
  var src = fs.readFileSync(CONSTANTS_JS, 'utf8');
  var marker = 'const AGENT_ROLES = {';
  var startIdx = src.indexOf(marker);
  if (startIdx === -1) throw new Error('AGENT_ROLES not found in constants.js');
  var depth = 0;
  var endIdx = -1;
  for (var i = startIdx + marker.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
  }
  if (endIdx === -1) throw new Error('AGENT_ROLES closing brace not found');
  var objSrc = src.substring(startIdx + marker.length - 1, endIdx);
  // eslint-disable-next-line no-eval
  var roles = eval('(' + objSrc + ')');
  return roles;
}

function fetchRuntimeConfigs() {
  return new Promise(function (resolve, reject) {
    var opts = {
      host: API_BASE,
      path: '/api/company-state?key=agentConfigs',
      headers: { 'x-company-secret': API_SECRET }
    };
    https.get(opts, function (res) {
      var body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        try {
          var parsed = JSON.parse(body);
          resolve(parsed.value || parsed || {});
        } catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function diff(label, agentId, canonical, compared, field) {
  if (canonical === compared) return null;
  return { agentId: agentId, field: field, source: label, canonical: canonical, compared: compared };
}

function run() {
  var canonical = loadCanonical();
  var constants = loadConstants();
  var drift = [];

  // Compare JSON vs constants.js AGENT_ROLES
  Object.keys(canonical).forEach(function (id) {
    var can = canonical[id];
    var con = constants[id];
    if (!con) {
      drift.push({ agentId: id, field: '_presence', source: 'constants.js', canonical: 'present', compared: 'MISSING from AGENT_ROLES' });
      return;
    }
    var roleDrift = diff('constants.js', id, can.role, con.role, 'role');
    if (roleDrift) drift.push(roleDrift);
    var tierDrift = diff('constants.js', id, can.tier, con.tier, 'tier');
    if (tierDrift) drift.push(tierDrift);
    var nameDrift = diff('constants.js', id, can.name, con.name, 'name');
    if (nameDrift) drift.push(nameDrift);
  });

  // Compare JSON vs runtime agentConfigs (optional)
  var runtimePromise = LIVE ? fetchRuntimeConfigs() : Promise.resolve(null);
  return runtimePromise.then(function (runtime) {
    if (runtime) {
      Object.keys(canonical).forEach(function (id) {
        var can = canonical[id];
        var rcfg = runtime[id];
        if (!rcfg) {
          drift.push({ agentId: id, field: '_presence', source: 'agentConfigs', canonical: 'present', compared: 'MISSING from runtime agentConfigs' });
          return;
        }
        // If systemPromptOverride is set, it's intentional — just flag that it replaces the canonical
        if (rcfg.systemPromptOverride && can.systemPrompt && rcfg.systemPromptOverride !== can.systemPrompt) {
          drift.push({
            agentId: id, field: 'systemPrompt', source: 'agentConfigs',
            canonical: can.systemPrompt.substring(0, 60) + '…',
            compared: 'overridden (' + String(rcfg.systemPromptOverride).length + ' chars) — verify still current'
          });
        }
        if (rcfg.roleOverride && rcfg.roleOverride !== can.role) {
          drift.push({ agentId: id, field: 'role', source: 'agentConfigs', canonical: can.role, compared: rcfg.roleOverride });
        }
        if (rcfg.titleOverride && rcfg.titleOverride !== can.title) {
          drift.push({ agentId: id, field: 'title', source: 'agentConfigs', canonical: can.title, compared: rcfg.titleOverride });
        }
      });
    }

    // Report
    if (JSON_OUT) {
      process.stdout.write(JSON.stringify({
        timestamp: new Date().toISOString(),
        live: LIVE,
        canonicalAgents: Object.keys(canonical).length,
        driftCount: drift.length,
        drift: drift
      }, null, 2) + '\n');
      process.exit(drift.length === 0 ? 0 : 1);
    }

    log('\nAgent Identity Drift Report — ' + new Date().toISOString());
    log('Canonical source: ' + AGENTS_JSON);
    log('Comparing: constants.js AGENT_ROLES' + (LIVE ? ' + runtime agentConfigs' : ' (use --live to also check runtime)'));
    log('');

    if (drift.length === 0) {
      log('✓ No drift detected. ' + Object.keys(canonical).length + ' agents in sync.');
      process.exit(0);
    }

    log('⚠ ' + drift.length + ' drift item(s) found:\n');
    var byAgent = {};
    drift.forEach(function (d) { (byAgent[d.agentId] = byAgent[d.agentId] || []).push(d); });
    Object.keys(byAgent).sort().forEach(function (id) {
      log('  [' + id + ']');
      byAgent[id].forEach(function (d) {
        log('    - ' + d.field + ' (' + d.source + ')');
        log('        canonical: ' + (d.canonical === null || d.canonical === undefined ? '(unset)' : d.canonical));
        log('        compared:  ' + (d.compared === null || d.compared === undefined ? '(unset)' : d.compared));
      });
    });

    log('\nTo fix:');
    log('  - Canonical vs constants.js drift → edit api/companyHeartbeat/constants.js AGENT_ROLES');
    log('  - Canonical vs agentConfigs drift → either update company-agents.json OR clear the runtime override');
    log('');
    process.exit(1);
  }).catch(function (err) {
    log('[validateAgentIdentity] ERROR: ' + (err && err.message || err));
    process.exit(2);
  });
}

run();
