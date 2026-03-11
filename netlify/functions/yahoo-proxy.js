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

  // ── MODALITÀ YAHOO QUOTE (float + vol + rvol, no crumb) ───────
  if (params.mode === 'quotesummary') {
    const { symbol } = params;
    if (!symbol) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing symbol' }) };

    const yHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${symbol}&fields=floatShares,regularMarketVolume,averageDailyVolume3Month,averageDailyVolume10Day`;
      const r = await fetch(url, { headers: yHeaders, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return { statusCode: r.status, headers, body: JSON.stringify({ error: `Yahoo quote error ${r.status}` }) };

      const data = await r.json();
      const quote = data?.quoteResponse?.result?.[0];
      if (!quote) return { statusCode: 200, headers, body: JSON.stringify({ quoteSummary: { result: null } }) };

      const normalized = {
        quoteSummary: {
          result: [{
            defaultKeyStatistics: { floatShares: { raw: quote.floatShares || null } },
            summaryDetail: {
              volume: { raw: quote.regularMarketVolume || null },
              averageVolume: { raw: quote.averageDailyVolume3Month || quote.averageDailyVolume10Day || null }
            }
          }]
        }
      };
      return { statusCode: 200, headers, body: JSON.stringify(normalized) };
    } catch(e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── MODALITÀ YAHOO QUOTE BATCH (vol + rvol per simboli multipli) ──
  if (params.mode === 'quote') {
    const { symbols } = params;
    if (!symbols) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing symbols' }) };

    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${symbols}&fields=regularMarketVolume,averageDailyVolume3Month,averageDailyVolume10Day`;
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return { statusCode: r.status, headers, body: JSON.stringify({ error: `Yahoo quote error ${r.status}` }) };
      const data = await r.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    } catch(e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── MODALITÀ YAHOO MICRO-FLOAT (senza crumb) ────────────────
  if (params.mode === 'micro') {
    // Scarica most_actives + small_cap_gainers con count alto, filtra float < 10M lato server
    try {
      const urls = [
        'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=most_actives&count=200&formatted=false&lang=en-US&region=US',
        'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=small_cap_gainers&count=200&formatted=false&lang=en-US&region=US',
      ];
      const yHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      };
      const results = await Promise.all(urls.map(async url => {
        try {
          const r = await fetch(url, { headers: yHeaders, signal: AbortSignal.timeout(10000) });
          if (!r.ok) return [];
          const data = await r.json();
          return data?.finance?.result?.[0]?.quotes || [];
        } catch(e) { return []; }
      }));
      const seen = new Set();
      const allQuotes = [];
      results.flat().forEach(q => {
        if (q.symbol && !seen.has(q.symbol)) { seen.add(q.symbol); allQuotes.push(q); }
      });
      // Filtra: tieni solo ticker con float < 10M
      const micro = allQuotes.filter(q => {
        const float = q.floatShares || null;
        return float && float < 10_000_000;
      });
      const fakeResult = { finance: { result: [{ quotes: micro }] } };
      return { statusCode: 200, headers, body: JSON.stringify(fakeResult) };
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
