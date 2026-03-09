// netlify/functions/yahoo-proxy.js
// Proxy unificato: Yahoo predefined + Yahoo custom screener POST + FMP

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const params = event.queryStringParameters || {};

  // ── MODALITÀ FMP ──────────────────────────────────────────
  if (params.mode === 'fmp') {
    const { endpoint, symbol, apikey } = params;

    if (!apikey) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing apikey' }) };
    }

    const ALLOWED = ['gainers', 'shares-float'];
    if (!endpoint || !ALLOWED.includes(endpoint)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Endpoint non supportato: ${endpoint}` }) };
    }

    try {
      let url;
      if (endpoint === 'gainers') {
        url = `https://financialmodelingprep.com/stable/biggest-gainers?apikey=${apikey}`;
      } else if (endpoint === 'shares-float') {
        if (!symbol) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing symbol' }) };
        url = `https://financialmodelingprep.com/stable/shares-float?symbol=${symbol}&apikey=${apikey}`;
      }

      const response = await fetch(url, {
        headers: { 'User-Agent': 'market-intel/1.0' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { statusCode: response.status, headers, body: JSON.stringify({ error: `FMP error ${response.status}` }) };
      }

      const data = await response.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };

    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── MODALITÀ YAHOO CUSTOM SCREENER (POST) ─────────────────
  if (params.mode === 'micro') {
    try {
      // Ottieni crumb Yahoo
      let crumb = null;
      for (const host of ['query1', 'query2']) {
        try {
          const r = await fetch(`https://${host}.finance.yahoo.com/v1/test/csrfToken`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(6000),
          });
          if (r.ok) {
            const d = await r.json();
            crumb = d.query?.crumb || d.crumb || null;
            if (crumb) break;
          }
        } catch(e) {}
      }

      if (!crumb) {
        return { statusCode: 503, headers, body: JSON.stringify({ error: 'Yahoo crumb non disponibile' }) };
      }

      const screenerBody = {
        offset: 0,
        size: 100,
        sortField: 'percentchange',
        sortType: 'DESC',
        quoteType: 'EQUITY',
        query: {
          operator: 'AND',
          operands: [
            { operator: 'LT', operands: ['floatShares', 10000000] },
            { operator: 'GT', operands: ['percentchange', 3] },
            { operator: 'GT', operands: ['dayvolume', 50000] },
            { operator: 'GT', operands: ['intradayprice', 0.5] },
            { operator: 'LT', operands: ['intradayprice', 50] },
            { operator: 'EQ', operands: ['region', 'us'] },
          ],
        },
        userId: '',
        userIdType: 'guid',
      };

      const screenerRes = await fetch(
        `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US&formatted=false`,
        {
          method: 'POST',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(screenerBody),
          signal: AbortSignal.timeout(12000),
        }
      );

      if (!screenerRes.ok) {
        return { statusCode: screenerRes.status, headers, body: JSON.stringify({ error: `Yahoo screener error ${screenerRes.status}` }) };
      }

      const data = await screenerRes.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };

    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── MODALITÀ YAHOO PREDEFINED (default) ───────────────────
  const { scrId, count = '50' } = params;

  if (!scrId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing scrId o mode' }) };
  }

  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}&formatted=false&lang=en-US&region=US`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify({ error: `Yahoo error ${response.status}` }) };
    }

    const data = await response.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
