const config = require('../config');
const api = require('./api/eastmoney');
const depth = require('./api/marketDepth');
const smallDb = require('./storage/smallDatabase');
const { resolveStockFromRecord, stockFromParts, inferMarket, buildSecid } = require('./stocks');

const collectingCodes = new Set();
let pollTimer = null;
let lastPollMeta = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  ok: 0,
  fail: 0,
  skipped: 0,
  error: null,
};

function liveOpts() {
  return {
    pollIntervalSec: Number(config.smallLive?.pollIntervalSec || 60),
    maxWatchlist: Number(config.smallLive?.maxWatchlist || 200),
    lhbSyncIntervalMin: Number(config.smallLive?.lhbSyncIntervalMin || 60),
    collectOutsideHours: !!config.smallLive?.collectOutsideHours,
  };
}

function nowTimeStr() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

function minutesSince(localSqliteTime) {
  if (!localSqliteTime) return Infinity;
  const t = Date.parse(String(localSqliteTime).replace(' ', 'T'));
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 60000;
}

function tierVal(tiers, key, field) {
  const t = (tiers || []).find((x) => x.key === key);
  return t ? t[field] ?? null : null;
}

/**
 * 采集单票实时指标（行情/资金流/逐笔买卖/大单/龙虎榜）并写入 small-live.db
 */
async function collectOnce(stock, options = {}) {
  const force = !!options.force;
  const withDepth = options.withDepth !== false;
  const withLhb = options.withLhb !== false;
  const opts = liveOpts();

  const s = stock?.secid
    ? stock
    : stock?.code
      ? stockFromParts(stock.code, stock.name, stock.market)
      : resolveStockFromRecord(stock);
  if (!s?.code) return { ok: false, error: 'invalid_stock' };

  if (collectingCodes.has(s.code)) {
    return { skipped: true, reason: 'busy', code: s.code };
  }
  if (!force && !opts.collectOutsideHours && !api.isTradingTime()) {
    return { skipped: true, reason: 'non_trading_hours', code: s.code };
  }

  collectingCodes.add(s.code);
  const { code, secid, market } = s;
  const tradeDate = api.todayStr();

  try {
    const [quote, flow, tickPack, ext] = await Promise.all([
      api.getRealtimeQuote(secid, code, market),
      api.getCapitalFlow(secid).catch(() => null),
      withDepth ? depth.getTickDetails(secid, -100).catch(() => ({ ticks: [] })) : Promise.resolve({ ticks: [] }),
      withDepth ? depth.getExtendedQuote(secid).catch(() => ({})) : Promise.resolve({}),
    ]);

    if (!quote) return { ok: false, error: 'quote_empty', code };

    const ticks = tickPack?.ticks || [];
    const activeBuyVolume = ticks
      .filter((t) => t.side === 2)
      .reduce((sum, t) => sum + (t.volume || 0), 0);
    const activeSellVolume = ticks
      .filter((t) => t.side === 1)
      .reduce((sum, t) => sum + (t.volume || 0), 0);
    const largeOrders = depth.buildLargeOrderDistribution(ext || {});

    const row = {
      trade_date: tradeDate,
      trade_time: nowTimeStr(),
      code,
      price: quote.price,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      pre_close: quote.pre_close,
      volume: quote.volume,
      amount: quote.amount,
      turnover_rate: quote.turnover_rate,
      volume_ratio: quote.volume_ratio,
      amplitude: quote.amplitude,
      pct_change: quote.pct_change,
      change: quote.change,
      main_net_inflow: flow?.main_net_inflow ?? null,
      large_net_inflow: flow?.large_net_inflow ?? null,
      super_large_net_inflow: flow?.super_large_net_inflow ?? null,
      active_buy_volume: activeBuyVolume,
      active_sell_volume: activeSellVolume,
      tick_count: ticks.length,
      main_buy: largeOrders.main?.buy ?? null,
      main_sell: largeOrders.main?.sell ?? null,
      main_net: largeOrders.main?.net ?? null,
      super_large_buy: tierVal(largeOrders.tiers, 'super_large', 'buy'),
      super_large_sell: tierVal(largeOrders.tiers, 'super_large', 'sell'),
      large_buy: tierVal(largeOrders.tiers, 'large', 'buy'),
      large_sell: tierVal(largeOrders.tiers, 'large', 'sell'),
      payload: JSON.stringify({
        name: quote.name || s.name,
        largeOrders,
        tickStats: {
          count: ticks.length,
          activeBuyVolume,
          activeSellVolume,
        },
      }),
    };

    smallDb.insertMinuteSnapshot(row);
    smallDb.markPolled(code);

    let lhbSynced = 0;
    if (withLhb) {
      const watched = smallDb.getWatchlistStock(code);
      const due =
        force ||
        minutesSince(watched?.last_lhb_sync) >= opts.lhbSyncIntervalMin;
      if (due) {
        lhbSynced = await syncDragonTiger(s, 8);
        smallDb.markLhbSynced(code);
      }
    }

    return {
      ok: true,
      code,
      row,
      quote,
      lhbSynced,
      live: mapLiveRow(row, quote.name || s.name),
    };
  } finally {
    collectingCodes.delete(s.code);
  }
}

async function syncDragonTiger(stock, limit = 8) {
  const s = stock?.secid
    ? stock
    : stockFromParts(stock.code, stock.name, stock.market);
  const rows = await depth.getDragonTigerList(s.code, limit);
  for (const r of rows) {
    smallDb.upsertLhbRecord({
      trade_date: r.trade_date,
      code: s.code,
      reason: r.reason || '',
      net_amount: r.net_amount,
      buy_amount: r.buy_amount,
      sell_amount: r.sell_amount,
      pct_change: r.pct_change,
      payload: JSON.stringify(r),
    });
  }
  return rows.length;
}

function ensureWatch(stock, source = 'manual') {
  const s = stock?.secid
    ? stock
    : stockFromParts(
        stock.code,
        stock.name,
        stock.market || inferMarket(stock.code)
      );
  smallDb.upsertWatchlistStock({
    code: s.code,
    name: s.name,
    market: s.market || inferMarket(s.code),
    secid: s.secid || buildSecid(s.code, s.market || inferMarket(s.code)),
    source,
    active: 1,
  });
  smallDb.trimWatchlist(liveOpts().maxWatchlist);
  return s;
}

async function watchAndCollect(stock, source = 'lookup') {
  const s = ensureWatch(stock, source);
  const result = await collectOnce(s, { force: true, withDepth: true, withLhb: true });
  return { stock: s, ...result };
}

async function collectWatchlist(force = false) {
  const list = smallDb.getWatchlist(true);
  lastPollMeta = {
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ok: 0,
    fail: 0,
    skipped: 0,
    error: null,
    total: list.length,
  };

  const results = [];
  for (const row of list) {
    try {
      const r = await collectOnce(resolveStockFromRecord(row), { force });
      results.push(r);
      if (r.ok) lastPollMeta.ok++;
      else if (r.skipped) lastPollMeta.skipped++;
      else lastPollMeta.fail++;
    } catch (e) {
      lastPollMeta.fail++;
      results.push({ ok: false, code: row.code, error: e.message || String(e) });
    }
  }

  lastPollMeta.status = 'idle';
  lastPollMeta.finishedAt = new Date().toISOString();
  return results;
}

function mapLiveRow(row, name = '') {
  if (!row) return null;
  return {
    code: row.code,
    name: name || '',
    tradeDate: row.trade_date,
    tradeTime: row.trade_time,
    price: row.price,
    open: row.open,
    high: row.high,
    low: row.low,
    preClose: row.pre_close,
    volume: row.volume,
    amount: row.amount,
    turnoverRate: row.turnover_rate,
    volumeRatio: row.volume_ratio,
    amplitude: row.amplitude,
    pctChange: row.pct_change,
    change: row.change,
    mainNetInflow: row.main_net_inflow,
    largeNetInflow: row.large_net_inflow,
    superLargeNetInflow: row.super_large_net_inflow,
    activeBuyVolume: row.active_buy_volume,
    activeSellVolume: row.active_sell_volume,
    tickCount: row.tick_count,
    mainBuy: row.main_buy,
    mainSell: row.main_sell,
    mainNet: row.main_net,
    superLargeBuy: row.super_large_buy,
    superLargeSell: row.super_large_sell,
    largeBuy: row.large_buy,
    largeSell: row.large_sell,
  };
}

function getLiveBundle(code) {
  const watch = smallDb.getWatchlistStock(code);
  const snap = smallDb.getLatestSnapshot(code);
  const lhb = smallDb.getLhbRecords(code, 5);
  const fund = smallDb.getFundamentals(code);
  return {
    watch,
    live: mapLiveRow(snap, watch?.name || fund?.name || ''),
    snapshots: smallDb.getMinuteSnapshots(code, api.todayStr(), 240),
    lhb: lhb.map((r) => ({
      tradeDate: r.trade_date,
      reason: r.reason,
      netAmount: r.net_amount,
      buyAmount: r.buy_amount,
      sellAmount: r.sell_amount,
      pctChange: r.pct_change,
    })),
    fundamentalsUpdatedAt: fund?.updated_at || null,
  };
}

function startPolling() {
  stopPolling();
  const sec = Math.max(15, liveOpts().pollIntervalSec || 60);
  const tick = async () => {
    try {
      await collectWatchlist(false);
    } catch (e) {
      lastPollMeta.status = 'error';
      lastPollMeta.error = e.message || String(e);
      lastPollMeta.finishedAt = new Date().toISOString();
      console.warn('[small-live] poll failed:', e.message || e);
    }
  };
  // 启动后稍等再采，避免和 bootstrap 抢
  pollTimer = setInterval(tick, sec * 1000);
  if (typeof pollTimer.unref === 'function') pollTimer.unref();
  console.log(`[small-live] polling every ${sec}s -> ${smallDb.dbPath()}`);
  return { intervalSec: sec };
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function getPollStatus() {
  return {
    ...lastPollMeta,
    intervalSec: liveOpts().pollIntervalSec,
    trading: api.isTradingTime(),
    stats: smallDb.getStats(),
  };
}

module.exports = {
  collectOnce,
  collectWatchlist,
  syncDragonTiger,
  ensureWatch,
  watchAndCollect,
  mapLiveRow,
  getLiveBundle,
  startPolling,
  stopPolling,
  getPollStatus,
  liveOpts,
};
