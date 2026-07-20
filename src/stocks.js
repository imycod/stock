const api = require('./api/eastmoney');

function normalizeCode(input) {
  const code = String(input || '')
    .trim()
    .replace(/\D/g, '');
  if (code.length !== 6) return null;
  return code;
}

function inferMarket(code) {
  if (/^[56]/.test(code)) return 'SH';
  if (/^[03]/.test(code)) return 'SZ';
  if (/^[48]/.test(code)) return 'BJ';
  return 'SZ';
}

function buildSecid(code, market) {
  if (market === 'SH') return `1.${code}`;
  return `0.${code}`;
}

function stockFromParts(code, name, market) {
  const m = market || inferMarket(code);
  return {
    code,
    name: name || code,
    market: m,
    secid: buildSecid(code, m),
  };
}

async function resolveStock(codeInput, quoteApi = api) {
  const code = normalizeCode(codeInput);
  if (!code) throw new Error('无效股票代码，请输入 6 位数字');

  const market = inferMarket(code);
  const secid = buildSecid(code, market);
  const quote = await quoteApi.getRealtimeQuote(secid, code, market);

  return stockFromParts(code, quote.name || code, market);
}

function resolveStockFromRecord(row) {
  if (!row?.code) return null;
  return stockFromParts(row.code, row.name, row.market);
}

module.exports = {
  normalizeCode,
  inferMarket,
  buildSecid,
  stockFromParts,
  resolveStock,
  resolveStockFromRecord,
};