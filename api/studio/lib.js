// studio/lib.js — the pure checks behind /api/studio/* (no Azure, so they test in plain node).
//
// The studio serves private video-pipeline media (client work included), and the Function App host is
// publicly reachable, so every request authenticates here. Two credentials, both FAIL CLOSED:
//   x-studio-key           the operator's browser   (app setting STUDIO_ACCESS_KEY)
//   x-studio-worker-token  the worker on Chad's PC  (app setting STUDIO_WORKER_TOKEN)
// Deliberately NOT the CEO secret: runtime-config.js hands that to any signed-in user, and sign-up is open.
const crypto = require('crypto');

function safeEqual(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const isOperator = (req, env = process.env) => safeEqual(req.headers['x-studio-key'], env.STUDIO_ACCESS_KEY);
const isWorker = (req, env = process.env) => safeEqual(req.headers['x-studio-worker-token'], env.STUDIO_WORKER_TOKEN);

// Projects allowed in the cloud: STUDIO_PROJECTS=ambientpixels,hanson-agents. Unset means none (Xbox is never listed).
function hostedProjects(env = process.env) {
  return String(env.STUDIO_PROJECTS || '').split(',').map(s => s.trim()).filter(s => /^[a-z0-9][a-z0-9-]{0,62}$/.test(s));
}

// A manifest path is repo-relative inside the pipeline repo and must stay inside this project's own folders.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/;
function validFilePath(project, p) {
  if (typeof p !== 'string' || p.length > 300 || p.includes('\\')) return false;
  const parts = p.split('/');
  if (!parts.every(s => SEGMENT.test(s) && s !== '.' && s !== '..')) return false;
  return ['renders', 'projects', 'work'].includes(parts[0]) && parts[1] === project && parts.length > 2;
}

const blobKey = (project, p) => `projects/${project}/files/${p}`;

module.exports = { safeEqual, isOperator, isWorker, hostedProjects, validFilePath, blobKey };
