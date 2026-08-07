// as-analyze — POST /api/as-analyze
// Runs AmbientScore audit pipeline and returns score + findings
// Every scan (free or paid) runs full pipeline + stores report
// Payment unlocks the full report view

const crypto = require('crypto');
const storage = require('../_utils/companyStorage');
const { analyze } = require('../_lib/ambientScore/analyzer');
const stripeClient = require('../_lib/ambientScore/stripeClient');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const MAX_FREE_PER_HOUR = 5;

// ── URL Validation ───────────────────────────────────────────────

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Rate Limiting (blob-based, per IP) ───────────────────────────

async function checkRateLimit(ip) {
  const key = 'cc_ratelimit';
  const now = Date.now();
  const hourAgo = now - 3600000;

  let limits = await storage.getState(key) || {};

  // Clean up old entries (older than 1 hour)
  for (const k of Object.keys(limits)) {
    limits[k] = (limits[k] || []).filter(ts => ts > hourAgo);
    if (limits[k].length === 0) delete limits[k];
  }

  const ipHits = limits[ip] || [];
  if (ipHits.length >= MAX_FREE_PER_HOUR) {
    return true; // rate limited
  }

  // Record this hit
  ipHits.push(now);
  limits[ip] = ipHits;
  await storage.setState(key, limits);
  return false;
}

// ── Analytics Logging ────────────────────────────────────────────

async function logScan(event) {
  try {
    const analytics = (await storage.getState('cc_analytics')) || [];
    analytics.push(event);
    // Cap at 10000 entries, 90-day retention
    const cutoff = Date.now() - 90 * 86400000;
    const pruned = analytics.filter(e => new Date(e.timestamp).getTime() > cutoff).slice(-10000);
    await storage.setState('cc_analytics', pruned);
  } catch { /* non-critical */ }
}

// ── Scan-failure classification ──────────────────────────────────
// One mapping for both the synchronous handler and the background runner.
// The last near-miss here: an exact 'Blocked' match (capital B) filed real
// SSRF probes under ANALYSIS_FAILED because the DNS-rebinding refusal reads
// "blocked" in lowercase. Keep the /blocked/i test case-insensitive.

function classifyScanError(errMsg, blockMeta) {
  if (errMsg.includes('SITE_BLOCKED')) {
    const isCf = errMsg.includes('CLOUDFLARE');
    const provider = isCf ? 'cloudflare' : (blockMeta ? blockMeta.provider : 'unknown');
    return { errorCode: 'SITE_BLOCKED', provider: provider, resStatus: 403, resBody: { error: 'SITE_BLOCKED', provider: provider } };
  }
  if (errMsg.includes('SITE_TIMEOUT') || errMsg.includes('ETIMEDOUT')) {
    return { errorCode: 'SITE_TIMEOUT', resStatus: 504, resBody: { error: 'SITE_TIMEOUT' } };
  }
  if (errMsg.includes('SITE_UNREACHABLE') || errMsg.includes('ENOTFOUND') || errMsg.includes('ECONNREFUSED')) {
    return { errorCode: 'SITE_UNREACHABLE', resStatus: 502, resBody: { error: 'SITE_TIMEOUT' } };
  }
  if (errMsg.includes('SITE_UNREADABLE')) {
    // We could not see the page. A score built on that is wrong, not partial.
    return { errorCode: 'SITE_UNREADABLE', resStatus: 422, resBody: { error: 'SITE_UNREADABLE' } };
  }
  if (errMsg.includes('SITE_ERROR_STATUS')) {
    // The URL resolved to an error page. Scoring it would sell an audit of a
    // "Page not found" as an audit of the customer's site.
    const statusMatch = errMsg.match(/HTTP (\d{3})/);
    const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
    return { errorCode: 'SITE_ERROR_STATUS', httpStatus: httpStatus, resStatus: 422, resBody: { error: 'SITE_ERROR_STATUS', httpStatus: httpStatus } };
  }
  if (errMsg.includes('status code 403') || errMsg.includes('status code 429')) {
    return { errorCode: 'SITE_BLOCKED', provider: 'unknown', resStatus: 403, resBody: { error: 'SITE_BLOCKED', provider: 'unknown' } };
  }
  if (/blocked/i.test(errMsg) || errMsg.includes('not allowed') || errMsg.includes('Invalid URL')) {
    return { errorCode: 'VALIDATION', resStatus: 400, resBody: { error: errMsg } };
  }
  return { errorCode: 'ANALYSIS_FAILED', resStatus: 500, resBody: { error: 'ANALYSIS_FAILED', detail: errMsg.substring(0, 200) } };
}

// Structured failure telemetry — captures provider, status, body preview for
// scraper calibration. Shared by the sync catch and the background runner.
function buildFailureLog(url, errMsg, blockMeta, classified) {
  return {
    timestamp: new Date().toISOString(),
    url: url || '',
    errorCode: classified.errorCode,
    provider: classified.provider || (blockMeta ? blockMeta.provider : null),
    httpStatus: classified.httpStatus != null ? classified.httpStatus : (blockMeta ? blockMeta.status : null),
    hostname: blockMeta ? blockMeta.hostname : null,
    cfRay: blockMeta ? blockMeta.cfRay : null,
    server: blockMeta ? blockMeta.server : null,
    bodyPreview: blockMeta ? blockMeta.bodyPreview : null,
    cfSignals: blockMeta ? blockMeta.cfSignals : null,
    errMsg: errMsg.substring(0, 200)
  };
}

// ── Background analysis ──────────────────────────────────────────
// The synchronous free scan ran ~222s against Azure Consumption's ~230s HTTP
// gateway limit. Both tiers now answer immediately with an analyzing stub and
// run the pipeline behind the response; the client polls as-report. The stub
// is written (and awaited) before the response so there is always something
// to poll, and every terminal state — success or failure — overwrites it, so
// a poller always finds out what happened. as-report treats a stub older than
// its stale window as failed, which covers the orphan case where the worker
// froze before writing any terminal state.

async function startBackgroundAnalysis(context, url, reportId, tier) {
  const key = 'cc_report_' + reportId;
  const startedAt = new Date().toISOString();
  const stubFor = (stage) => ({
    id: reportId, url: url, status: 'analyzing', stage: stage,
    createdAt: startedAt, startedAt: startedAt
  });

  // Awaited: the client must have something to poll before we answer.
  await storage.setState(key, stubFor('fetch'));

  // Deliberately not awaited from here on.
  analyze(url, { onStage: (stage) => storage.setState(key, stubFor(stage)) })
    .then(async (result) => {
      result.fullReport.id = reportId;
      // A payment or refund can land while analysis is still running — the
      // finished report must not clobber what the money already decided.
      try {
        const existing = await storage.getState(key);
        if (existing && existing.unlocked) {
          result.fullReport.unlocked = true;
          result.fullReport.paidAt = existing.paidAt || null;
          result.fullReport.customerEmail = existing.customerEmail || null;
          result.fullReport.priceType = existing.priceType || 'single';
        }
        if (existing && existing.revokedAt) {
          result.fullReport.unlocked = false;
          result.fullReport.revokedAt = existing.revokedAt;
          result.fullReport.revokedReason = existing.revokedReason || null;
        }
      } catch (mergeErr) { /* merge is best-effort */ }
      await storage.setState(key, result.fullReport);
      await logScan({ reportId, url, tier: tier, score: result.score, timestamp: new Date().toISOString() });
    })
    .catch(async (err) => {
      const errMsg = (err && err.message) || '';
      const blockMeta = (err && err.blockMeta) || null;
      const classified = classifyScanError(errMsg, blockMeta);
      try {
        await storage.setState(key, {
          id: reportId, url: url, status: 'failed',
          errorCode: classified.errorCode,
          errorDetail: classified.errorCode === 'VALIDATION' ? errMsg.substring(0, 200) : null,
          httpStatus: classified.httpStatus != null ? classified.httpStatus : null,
          createdAt: startedAt, startedAt: startedAt,
          failedAt: new Date().toISOString()
        });
      } catch (writeErr) {
        context.log.error('[as-analyze] Failed-stub write failed for ' + reportId + ':', writeErr.message);
      }
      const failureLog = buildFailureLog(url, errMsg, blockMeta, classified);
      context.log.warn('[as-analyze] Background scan failure:', JSON.stringify(failureLog));
      logScan({
        url: failureLog.url, tier: 'failed', errorCode: failureLog.errorCode,
        provider: failureLog.provider, httpStatus: failureLog.httpStatus,
        timestamp: failureLog.timestamp
      }).catch(function () {});
    });
}

// ── Handler ──────────────────────────────────────────────────────

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS };
    return;
  }

  try {
    const body = req.body || {};
    const url = (body.url || '').trim();
    const sessionId = body.sessionId || null;

    // If sessionId provided, verify payment and unlock existing report (no URL needed)
    if (sessionId) {
      const payment = await stripeClient.verifySession(sessionId);
      if (payment.valid && payment.metadata && payment.metadata.reportId) {
        const existingId = payment.metadata.reportId;
        const existing = await storage.getState('cc_report_' + existingId);
        if (existing) {
          existing.unlocked = true;
          existing.paidAt = new Date().toISOString();
          existing.customerEmail = payment.customerEmail || null;
          existing.priceType = payment.metadata.priceType || 'single';
          await storage.setState('cc_report_' + existingId, existing);

          // Grant pack credits if this was a 3-pack purchase (idempotent with webhook)
          var packCreditsRemaining = null;
          if (payment.metadata.priceType === 'pack' && payment.customerEmail) {
            try {
              const creditUtils = require('../_lib/ambientScore/creditUtils');
              var creditResult = await creditUtils.grantPackCredits({
                email: payment.customerEmail,
                stripeSessionId: sessionId,
                reportId: existingId
              });
              if (creditResult) {
                packCreditsRemaining = creditResult.credits;
              } else {
                // Webhook already processed — read existing record
                var creditsKey = creditUtils.emailToCreditsKey(payment.customerEmail);
                var existingCredits = await storage.getState(creditsKey);
                if (existingCredits) packCreditsRemaining = existingCredits.credits;
              }
            } catch (creditErr) {
              context.log.warn('[as-analyze] Credit creation failed (non-fatal):', creditErr.message);
            }
          }

          context.res = {
            status: 200,
            headers: CORS,
            body: JSON.stringify({
              ok: true,
              reportId: existingId,
              score: existing.score,
              grade: existing.grade,
              isPaid: true,
              reportUrl: '/ambientscore/report.html?id=' + existingId,
              priceType: payment.metadata.priceType || 'single',
              packCreditsRemaining: packCreditsRemaining
            })
          };
          return;
        }
      }
      // If verification failed, fall through to normal flow
    }

    // Email-my-scorecard: send the teaser report to a captured lead (free tier).
    // The lead is stored even if the send fails — the address is the asset.
    if (body.emailReport && body.reportId && body.email) {
      const email = String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'A valid email is required.' }) };
        return;
      }
      if (!String(body.reportId).startsWith('ccr_')) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'Valid report ID required.' }) };
        return;
      }
      const emailIp = (req.headers['x-forwarded-for'] || req.headers['x-client-ip'] || 'unknown').split(',')[0].trim();
      if (await checkRateLimit(emailIp)) {
        context.res = { status: 429, headers: CORS, body: JSON.stringify({ error: 'Rate limit exceeded. Try again in an hour.' }) };
        return;
      }
      const emailedReport = await storage.getState('cc_report_' + body.reportId);
      if (!emailedReport) {
        context.res = { status: 404, headers: CORS, body: JSON.stringify({ error: 'Report not found.' }) };
        return;
      }
      try {
        const leads = (await storage.getState('as_leads')) || [];
        leads.push({
          email: email,
          reportId: emailedReport.id || body.reportId,
          url: emailedReport.url || null,
          score: emailedReport.score != null ? emailedReport.score : null,
          utmContent: body.utm_content || null,
          utmSource: body.utm_source || null,
          source: 'free-scan-email',
          ts: new Date().toISOString()
        });
        await storage.setState('as_leads', leads.slice(-5000));
      } catch (leadErr) {
        context.log.warn('[as-analyze] Lead store failed (non-fatal):', leadErr.message);
      }
      let sent = false;
      try {
        const { sendReportEmail } = require('../_lib/ambientScore/emailSender');
        sent = await sendReportEmail(email, {
          id: emailedReport.id || body.reportId,
          url: emailedReport.url,
          score: emailedReport.score,
          grade: emailedReport.grade,
          findings: emailedReport.teaserFindings || (emailedReport.findings || []).slice(0, 3)
        });
      } catch (mailErr) {
        context.log.warn('[as-analyze] Scorecard email failed (non-fatal):', mailErr.message);
      }
      context.res = { status: 200, headers: CORS, body: JSON.stringify({ ok: true, sent: sent }) };
      return;
    }

    // Validate URL
    if (!url || !isValidUrl(url)) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'A valid HTTP/HTTPS URL is required.' }) };
      return;
    }

    // Rate limit check
    if (!sessionId) {
      const clientIp = (req.headers['x-forwarded-for'] || req.headers['x-client-ip'] || 'unknown').split(',')[0].trim();
      const limited = await checkRateLimit(clientIp);
      if (limited) {
        context.res = { status: 429, headers: CORS, body: JSON.stringify({ error: 'Rate limit exceeded. Maximum ' + MAX_FREE_PER_HOUR + ' free scans per hour. Upgrade for unlimited access.' }) };
        return;
      }
    }

    // If createCheckout requested, create Stripe session and return URL
    // Reuse existing reportId from free scan if provided (report already in blob)
    if (body.createCheckout) {
      const reportId = body.reportId || ('ccr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'));
      const priceType = body.priceType === 'pack' ? 'pack' : 'single';
      const checkout = await stripeClient.createCheckoutSession({
        reportId: reportId,
        url: url,
        email: body.email || '',
        priceType: priceType,
        utmContent: body.utm_content || null,
        utmSource: body.utm_source || null
      });

      // Only run analysis if no existing report (i.e. no reportId was provided)
      if (!body.reportId) {
        await startBackgroundAnalysis(context, url, reportId, 'paid-' + priceType);
      }

      context.res = {
        status: 200,
        headers: CORS,
        body: JSON.stringify({
          ok: true,
          reportId: reportId,
          checkoutUrl: checkout.checkoutUrl,
          sessionId: checkout.sessionId
        })
      };
      return;
    }

    // Generate report ID for free scan
    const reportId = 'ccr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');

    // Free scan — answer immediately, analyze behind the response. The client
    // polls as-report, which serves the analyzing/failed stub states and, on
    // completion, the teaser (including the estimated-score disclaimer and
    // dimension counts the buying decision needs).
    await startBackgroundAnalysis(context, url, reportId, 'free');

    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        reportId: reportId,
        status: 'analyzing'
      })
    };

  } catch (err) {
    const errMsg = err.message || '';
    const blockMeta = err.blockMeta || null;
    const classified = classifyScanError(errMsg, blockMeta);
    const failureLog = buildFailureLog((req.body && req.body.url) || '', errMsg, blockMeta, classified);

    context.res = { status: classified.resStatus, headers: CORS, body: JSON.stringify(classified.resBody) };

    // Log for calibration (non-blocking)
    context.log.warn('[as-analyze] Scan failure:', JSON.stringify(failureLog));
    logScan({
      url: failureLog.url,
      tier: 'failed',
      errorCode: failureLog.errorCode,
      provider: failureLog.provider,
      httpStatus: failureLog.httpStatus,
      timestamp: failureLog.timestamp
    }).catch(function () {});
  }
};
