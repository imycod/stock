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

/** 配置项：'600759' 或 { code, name } */
function normalizeWatchEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const code = normalizeCode(entry);
    return code ? { code, name: null } : null;
  }
  if (typeof entry === 'object' && entry.code) {
    const code = normalizeCode(entry.code);
    if (!code) return null;
    const name = entry.name != null ? String(entry.name).trim() : null;
    return { code, name: name || null };
  }
  return null;
}

function normalizeWatchlist(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const e = normalizeWatchEntry(raw);
    if (!e || seen.has(e.code)) continue;
    seen.add(e.code);
    out.push(e);
  }
  return out;
}

function isGarbledStockName(name) {
  if (!name) return true;
  if (/\uFFFD/.test(name)) return true;
  const cjk = (name.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk >= 1) return false;
  if (name.length > 2 && /[^A-Za-z0-9*ST\s.-]/.test(name)) return true;
  return false;
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

async function resolveStock(codeInput, quoteApi = api, options = {}) {
  const code = normalizeCode(codeInput);
  if (!code) throw new Error('无效股票代码，请输入 6 位数字');

  const preferredName = options.preferredName?.trim();
  const market = inferMarket(code);
  const secid = buildSecid(code, market);

  if (preferredName && !isGarbledStockName(preferredName)) {
    return stockFromParts(code, preferredName, market);
  }

  const quote = await quoteApi.getRealtimeQuote(secid, code, market);
  let name = quote.name || code;
  if (isGarbledStockName(name)) {
    name = preferredName || code;
  }
  return stockFromParts(code, name, market);
}

function resolveStockFromRecord(row) {
  if (!row?.code) return null;
  return stockFromParts(row.code, row.name, row.market);
}

function stockFromConfigEntry(entry) {
  const e = normalizeWatchEntry(entry);
  if (!e) return null;
  if (e.name && !isGarbledStockName(e.name)) {
    return stockFromParts(e.code, e.name, null);
  }
  return stockFromParts(e.code, e.code, null);
}

module.exports = {
  normalizeCode,
  inferMarket,
  buildSecid,
  normalizeWatchEntry,
  normalizeWatchlist,
  isGarbledStockName,
  stockFromParts,
  resolveStock,
  resolveStockFromRecord,
  stockFromConfigEntry,
};
