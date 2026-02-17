// azureCosts — GET API for Azure subscription cost data via Cost Management API
// GET /api/azureCosts           → current month costs
// GET /api/azureCosts?days=30   → last N days costs
// Requires: AZURE_SUBSCRIPTION_ID env var + managed identity with Cost Management Reader role

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    // Require auth
    const secret = req.headers['x-company-secret'] || '';
    if (!storage.validateSecret(secret)) {
      context.res = { status: 401, headers: corsHeaders, body: { error: 'unauthorized' } };
      return;
    }

    const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
    if (!subscriptionId) {
      context.res = { status: 500, headers: corsHeaders, body: { error: 'AZURE_SUBSCRIPTION_ID not configured' } };
      return;
    }

    const days = Math.min(parseInt(req.query && req.query.days) || 30, 90);
    const now = new Date();
    const startDate = new Date(now.getTime() - days * 86400000);
    const startStr = startDate.toISOString().substring(0, 10);
    const endStr = now.toISOString().substring(0, 10);

    // Get access token via managed identity
    const { DefaultAzureCredential } = require('@azure/identity');
    const credential = new DefaultAzureCredential();
    const tokenResponse = await credential.getToken('https://management.azure.com/.default');

    if (!tokenResponse || !tokenResponse.token) {
      context.res = { status: 500, headers: corsHeaders, body: { error: 'Failed to acquire Azure management token' } };
      return;
    }

    // Call Cost Management API — query costs grouped by ServiceName and day
    const costApiUrl = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;

    const costBody = {
      type: 'ActualCost',
      timeframe: 'Custom',
      timePeriod: {
        from: startStr,
        to: endStr
      },
      dataset: {
        granularity: 'Daily',
        aggregation: {
          totalCost: { name: 'Cost', function: 'Sum' },
          totalCostUSD: { name: 'CostUSD', function: 'Sum' }
        },
        grouping: [
          { type: 'Dimension', name: 'ServiceName' }
        ]
      }
    };

    const costRes = await fetch(costApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + tokenResponse.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(costBody)
    });

    if (!costRes.ok) {
      const errText = await costRes.text();
      context.log.error('[AzureCosts] Cost Management API error:', costRes.status, errText.substring(0, 500));
      context.res = {
        status: costRes.status,
        headers: corsHeaders,
        body: { error: 'Cost Management API returned ' + costRes.status, details: errText.substring(0, 300) }
      };
      return;
    }

    const costData = await costRes.json();

    // Parse the tabular response
    // columns: [Cost, CostUSD, UsageDate, ServiceName, Currency]
    const columns = (costData.properties && costData.properties.columns) || [];
    const rows = (costData.properties && costData.properties.rows) || [];

    const colIndex = {};
    columns.forEach(function (col, i) { colIndex[col.name] = i; });

    const costIdx = colIndex['Cost'] !== undefined ? colIndex['Cost'] : 0;
    const costUsdIdx = colIndex['CostUSD'] !== undefined ? colIndex['CostUSD'] : 1;
    const dateIdx = colIndex['UsageDate'] !== undefined ? colIndex['UsageDate'] : 2;
    const serviceIdx = colIndex['ServiceName'] !== undefined ? colIndex['ServiceName'] : 3;
    const currencyIdx = colIndex['Currency'] !== undefined ? colIndex['Currency'] : 4;

    // Aggregate
    let totalCost = 0;
    let totalCostUSD = 0;
    const byDay = {};
    const byService = {};
    let currency = 'USD';

    rows.forEach(function (row) {
      const cost = row[costIdx] || 0;
      const costUsd = row[costUsdIdx] || 0;
      // UsageDate comes as number YYYYMMDD or string
      let dateRaw = row[dateIdx];
      let dateStr;
      if (typeof dateRaw === 'number') {
        dateStr = String(dateRaw);
        dateStr = dateStr.substring(0, 4) + '-' + dateStr.substring(4, 6) + '-' + dateStr.substring(6, 8);
      } else {
        dateStr = String(dateRaw).substring(0, 10);
      }
      const service = row[serviceIdx] || 'Other';
      if (row[currencyIdx]) currency = row[currencyIdx];

      totalCost += cost;
      totalCostUSD += costUsd;

      if (!byDay[dateStr]) byDay[dateStr] = { cost: 0, costUSD: 0 };
      byDay[dateStr].cost += cost;
      byDay[dateStr].costUSD += costUsd;

      if (!byService[service]) byService[service] = { cost: 0, costUSD: 0 };
      byService[service].cost += cost;
      byService[service].costUSD += costUsd;
    });

    // Round values
    totalCost = Math.round(totalCost * 100) / 100;
    totalCostUSD = Math.round(totalCostUSD * 100) / 100;
    Object.keys(byDay).forEach(function (d) {
      byDay[d].cost = Math.round(byDay[d].cost * 10000) / 10000;
      byDay[d].costUSD = Math.round(byDay[d].costUSD * 10000) / 10000;
    });
    Object.keys(byService).forEach(function (s) {
      byService[s].cost = Math.round(byService[s].cost * 10000) / 10000;
      byService[s].costUSD = Math.round(byService[s].costUSD * 10000) / 10000;
    });

    const dayCount = Object.keys(byDay).length;
    const avgPerDay = dayCount > 0 ? Math.round((totalCost / dayCount) * 10000) / 10000 : 0;

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        period: days + 'd',
        startDate: startStr,
        endDate: endStr,
        currency: currency,
        totalCost: totalCost,
        totalCostUSD: totalCostUSD,
        avgPerDay: avgPerDay,
        projectedMonthly: Math.round(avgPerDay * 30 * 100) / 100,
        serviceCount: Object.keys(byService).length,
        byDay: byDay,
        byService: byService
      }
    };

  } catch (err) {
    context.log.error('[AzureCosts] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'internal_error', message: err.message }
    };
  }
};
