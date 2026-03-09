// netlify/functions/fmp.js
// Proxy per Financial Modeling Prep API — evita CORS dal browser
// Endpoint supportati: gainers, shares-float

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { endpoint, symbol, apikey } = event.queryStringParameters || {};

  if (!apikey) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing apikey' }) };
  }

  // Endpoint whitelist — sicurezza
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
      url = `https://financialmodelingprep.com/api/v4/stock_float?symbol=${symbol}&apikey=${apikey}`;
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
};
