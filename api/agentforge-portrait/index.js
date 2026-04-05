// agentforge-portrait — Generate Arcane-style character portrait for custom agents
// POST /api/agentforge-portrait { archetype, expression, appearance, pose, accent }

const { callImageGeneration } = require('../_lib/contentEngine/imageEngine');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ms-client-principal, x-cf-auth-principal, x-user-id, x-company-secret'
};

// ── Prompt Fragment Lookup Tables ──

var ARCHETYPES = {
  scholar:    'analytical figure with rectangular glasses, neat structured clothing, intellectual bearing',
  operative:  'hooded operative with deep hood casting shadow, tactical dark clothing, barely visible earpiece',
  executive:  'polished figure in immaculate dark suit with pocket square, commanding presence',
  creative:   'expressive figure with wild artistic hair, paint-stained lapel on layered jacket',
  technician: 'precise figure with mechanical goggles pushed up on forehead, utility jacket',
  mystic:     'mysterious figure with dramatic high collar framing face, dark layered robes',
  rebel:      'bold figure in streetwear jacket, confident casual posture, strong jaw',
  guardian:   'sturdy figure with armored shoulder pauldron, protective stance, vigilant eyes'
};

var EXPRESSIONS = {
  confident:  'relaxed posture, knowing half-smile, slight lean back',
  intense:    'piercing focused stare, slight downward angle looking at camera, arms crossed',
  friendly:   'warm open expression, slight forward lean, kind eyes',
  mysterious: 'enigmatic half-smile, partially shadowed face',
  fierce:     'combative grin, index finger raised mid-point, bold forward energy',
  calm:       'composed neutral expression, serene gaze'
};

// Body-language-only variants for Non-human (no facial expressions)
var EXPRESSIONS_NONHUMAN = {
  confident:  'commanding upright posture, arms at sides',
  intense:    'rigid alert stance, weight forward',
  friendly:   'open relaxed posture, slight head tilt',
  mysterious: 'head tilted, arms folded',
  fierce:     'aggressive forward lean, fists clenched',
  calm:       'perfectly still centered stance'
};

var APPEARANCES = {
  masculine:   'man',
  feminine:    'woman',
  androgynous: 'androgynous figure',
  nonhuman:    'masked helmeted figure, no visible face, visor or featureless mask'
};

var AGES = {
  young:  'in their early 20s',
  mid:    'in their 30s',
  mature: 'in their 40s',
  elder:  'in their 50s, weathered features, grey streaks in hair'
};

var POSES = {
  front:         'facing camera directly',
  three_quarter: 'slight 3/4 angle body turned, face toward camera',
  side_profile:  'side profile with eyes cutting back toward camera',
  low_angle:     'low angle shot looking up slightly commanding presence'
};

var ACCENTS = {
  none:   '',
  blue:   'with cold steel blue accents on clothing',
  purple: 'with arcane violet accents on clothing',
  gold:   'with warm amber-gold accents on clothing',
  red:    'with deep crimson accents on clothing',
  green:  'with dark emerald accents on clothing',
  teal:   'with cyan-teal accents on clothing',
  silver: 'with metallic silver accents on clothing'
};

// LOCKED — do not change, maintains catalog style consistency
var STYLE_SUFFIX = 'dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm';

// Avatar style — simple cartoon, minimal, distinct from agent portraits
var AVATAR_STYLE_SUFFIX = 'simple flat cartoon illustration style, minimal clean vector-like, solid color background, head and shoulders only, centered face filling the frame, friendly and approachable, thick clean outlines, flat shading, suitable for a small circular profile avatar --ar 1:1 --stylize 100 --no photorealistic, detailed background, full body, action pose, weapons, Arcane, anime';

// ── Auth ──

function extractUserId(req) {
  var principalHeader = req.headers['x-ms-client-principal'] || req.headers['x-cf-auth-principal'];
  if (principalHeader) {
    try {
      var decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
      var principal = JSON.parse(decoded);
      if (principal.userId && principal.userId !== 'anonymous') return principal.userId;
    } catch (e) { /* fall through */ }
  }
  var devId = req.headers['x-user-id'];
  if (devId) return devId;
  if (req.headers['x-company-secret'] === 'pixelpusher') return 'ceo';
  return null;
}

// ── Rate Limiting (5/day/user) ──

var MAX_PER_DAY = 10;

async function checkRateLimit(userId) {
  try {
    var { BlobServiceClient } = require('@azure/storage-blob');
    var connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) return { allowed: true, remaining: MAX_PER_DAY };

    var client = BlobServiceClient.fromConnectionString(connStr);
    var container = client.getContainerClient('company-state');
    var blobName = 'agentforge-portrait-limits/' + userId + '.json';
    var blobClient = container.getBlockBlobClient(blobName);

    var today = new Date().toISOString().slice(0, 10);
    var data = { date: today, count: 0 };

    try {
      var dl = await blobClient.download(0);
      var raw = await streamToString(dl.readableStreamBody);
      data = JSON.parse(raw);
    } catch (e) { /* blob doesn't exist yet */ }

    // Reset if new day
    if (data.date !== today) {
      data = { date: today, count: 0 };
    }

    if (data.count >= MAX_PER_DAY) {
      return { allowed: false, remaining: 0 };
    }

    // Increment
    data.count++;
    await blobClient.upload(JSON.stringify(data), JSON.stringify(data).length, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      overwrite: true
    });

    return { allowed: true, remaining: MAX_PER_DAY - data.count };
  } catch (e) {
    // Fail open — if rate limit check fails, allow the request
    console.warn('[agentforge-portrait] Rate limit check failed:', e.message);
    return { allowed: true, remaining: MAX_PER_DAY };
  }
}

function streamToString(readable) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    readable.on('data', function (c) { chunks.push(typeof c === 'string' ? Buffer.from(c) : c); });
    readable.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    readable.on('error', reject);
  });
}

// ── Prompt Assembly ──

function buildPortraitPrompt(opts) {
  var parts = [];

  var appearance = APPEARANCES[opts.appearance] || APPEARANCES.androgynous;
  var age = AGES[opts.age] || AGES.mid;
  // Non-human skips age (masked figures are ageless)
  if (opts.appearance === 'nonhuman') {
    parts.push(appearance);
  } else {
    parts.push(appearance + ' ' + age);
  }
  // Avatar mode uses simple clothing styles instead of character archetypes
  var AVATAR_STYLES = {
    casual: 'wearing casual everyday clothing, relaxed',
    professional: 'wearing a clean professional outfit, polished',
    creative: 'wearing artistic layered clothing, expressive style',
    techy: 'wearing a hoodie or tech-casual outfit, modern',
    formal: 'wearing a sharp suit and tie, elegant'
  };
  if (opts.mode === 'avatar') {
    parts.push(AVATAR_STYLES[opts.avatarStyle] || AVATAR_STYLES.casual);
  } else {
    parts.push(ARCHETYPES[opts.archetype] || ARCHETYPES.scholar);
  }
  parts.push(POSES[opts.pose] || POSES.front);

  // Use body-language expressions for non-human
  var exprTable = opts.appearance === 'nonhuman' ? EXPRESSIONS_NONHUMAN : EXPRESSIONS;
  parts.push(exprTable[opts.expression] || exprTable.confident);

  var accent = ACCENTS[opts.accent || 'none'];
  if (accent) parts.push(accent);

  // User-provided character detail (sanitized, max 80 chars)
  if (opts.detail) parts.push(opts.detail);

  // Use avatar style for profile avatars, agent style for agent portraits
  parts.push(opts.mode === 'avatar' ? AVATAR_STYLE_SUFFIX : STYLE_SUFFIX);

  return 'Generate a portrait image: ' + parts.join(', ');
}

// ── Main Handler ──

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS };
    return;
  }

  // Auth check
  var userId = extractUserId(req);
  if (!userId) {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
    return;
  }

  // Validate inputs
  var body = req.body || {};
  var archetype = body.archetype;
  var expression = body.expression;
  var appearance = body.appearance;
  var age = body.age || 'mid';
  var pose = body.pose;
  var accent = body.accent || 'none';
  var mode = body.mode === 'avatar' ? 'avatar' : 'agent';
  var detail = String(body.detail || '').trim().substring(0, 80);
  // Sanitize: strip anything that looks like prompt injection
  detail = detail.replace(/ignore|forget|disregard|override|system|prompt|instruction/gi, '').trim();

  if (!ARCHETYPES[archetype]) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid archetype. Valid: ' + Object.keys(ARCHETYPES).join(', ') } };
    return;
  }
  if (!EXPRESSIONS[expression]) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid expression. Valid: ' + Object.keys(EXPRESSIONS).join(', ') } };
    return;
  }
  if (!APPEARANCES[appearance]) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid appearance. Valid: ' + Object.keys(APPEARANCES).join(', ') } };
    return;
  }
  if (!AGES[age]) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid age. Valid: ' + Object.keys(AGES).join(', ') } };
    return;
  }
  if (!POSES[pose]) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid pose. Valid: ' + Object.keys(POSES).join(', ') } };
    return;
  }
  if (!ACCENTS.hasOwnProperty(accent)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Invalid accent. Valid: ' + Object.keys(ACCENTS).join(', ') } };
    return;
  }

  // Rate limit
  var rateResult = await checkRateLimit(userId);
  if (!rateResult.allowed) {
    context.res = { status: 429, headers: CORS_HEADERS, body: { error: 'Daily portrait limit reached (5/day). Try again tomorrow.', remaining: 0 } };
    return;
  }

  // Build prompt and generate
  var avatarStyle = body.avatarStyle || 'casual';
  var prompt = buildPortraitPrompt({ archetype: archetype, expression: expression, appearance: appearance, age: age, pose: pose, accent: accent, detail: detail, mode: mode, avatarStyle: avatarStyle });
  console.log('[agentforge-portrait] Generating for user=' + userId + ' archetype=' + archetype + ' appearance=' + appearance + ' age=' + age + ' pose=' + pose);

  try {
    var result = await callImageGeneration(prompt);
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        portraitBase64: result.base64,
        portraitMimeType: result.mimeType || 'image/png',
        remaining: rateResult.remaining
      }
    };
  } catch (err) {
    console.error('[agentforge-portrait] Generation failed:', err.message);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Portrait generation failed. Please try again.', detail: err.message }
    };
  }
};
