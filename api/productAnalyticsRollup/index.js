// productAnalyticsRollup — Daily rollup timer (runs 03:00 UTC)
// Reads yesterday's raw events, computes aggregates, writes rollup blob.
// Also maintains user-cohorts.json for retention analysis.

const pa = require('../_utils/productAnalytics');
const storage = require('../_utils/companyStorage');

function yesterday() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().substring(0, 10);
}

module.exports = async function (context) {
  var date = yesterday();
  context.log('[ProductAnalyticsRollup] Rolling up events for ' + date);

  try {
    var events = await pa.readEvents(date);
    if (!events || events.length === 0) {
      context.log('[ProductAnalyticsRollup] No events for ' + date + ', skipping.');
      return;
    }

    // Aggregate by product
    var products = {};
    var allUsers = new Set();
    var allSessions = new Set();

    events.forEach(function (e) {
      var p = e.product || 'unknown';
      if (!products[p]) products[p] = { uniqueUsers: new Set(), sessions: new Set(), events: {}, funnelCounts: {} };
      if (e.userId) { products[p].uniqueUsers.add(e.userId); allUsers.add(e.userId); }
      if (e.sessionId) { products[p].sessions.add(e.sessionId); allSessions.add(e.sessionId); }

      var eventKey = e.event || 'unknown';
      if (!products[p].events[eventKey]) products[p].events[eventKey] = 0;
      products[p].events[eventKey]++;
    });

    // Convert Sets to counts for serialization
    var productData = {};
    for (var p in products) {
      productData[p] = {
        uniqueUsers: products[p].uniqueUsers.size,
        sessions: products[p].sessions.size,
        events: products[p].events
      };
    }

    var rollup = {
      date: date,
      products: productData,
      totals: {
        uniqueUsers: allUsers.size,
        sessions: allSessions.size,
        totalEvents: events.length
      }
    };

    await storage.setState('pa/rollup-' + date, rollup);
    context.log('[ProductAnalyticsRollup] Wrote rollup for ' + date + ': ' + events.length + ' events, ' + allUsers.size + ' users');

    // Update user cohorts (first-seen tracking for retention)
    var cohorts = (await storage.getState('pa/user-cohorts')) || {};
    var newUsers = 0;
    events.forEach(function (e) {
      if (e.userId && !cohorts[e.userId]) {
        cohorts[e.userId] = { firstSeen: date, product: e.product };
        newUsers++;
      }
    });

    if (newUsers > 0) {
      // Cap cohorts at 10000 entries (remove oldest if needed)
      var keys = Object.keys(cohorts);
      if (keys.length > 10000) {
        var sorted = keys.sort(function (a, b) {
          return (cohorts[a].firstSeen || '').localeCompare(cohorts[b].firstSeen || '');
        });
        var toRemove = sorted.slice(0, keys.length - 10000);
        toRemove.forEach(function (k) { delete cohorts[k]; });
      }
      await storage.setState('pa/user-cohorts', cohorts);
      context.log('[ProductAnalyticsRollup] Updated cohorts: ' + newUsers + ' new users, ' + Object.keys(cohorts).length + ' total');
    }
  } catch (err) {
    context.log.error('[ProductAnalyticsRollup] Error:', err.message, err.stack);
  }
};
