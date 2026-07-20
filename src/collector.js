const config = require('../config');
const api = require('./api/eastmoney');
const db = require('./storage/database');
const depth = require('./api/marketDepth');
const { resolveStockFromRecord } = require('./stocks');

const collectingCodes = new Set();

async function collectOnce(stock, force = false) {
  const s = stock?.code ? stock : resolveStockFromRecord(stock);
  if (!s?.code) return { ok: false, error: 'invalid_stock' };

  if (collectingCodes.has(s.code)) return { skipped: true, reason: 'busy', code: s.code };
  if (!force && !api.isTradingTime()) {
    return { skipped: true, reason: 'non_trading_hours', code: s.code };
  }

  collectingCodes.add(s.code);
  const { code, secid, market } = s;
  const tradeDate = api.todayStr();

  try {
    const [quote, flow] = await Promise.all([
      api.getRealtimeQuote(secid, code, market),
      api.getCapitalFlow(secid).catch(() => null),
    ]);

    if (!quote) {
      return { ok: false, error: 'quote_empty', code };
    }

    const now = new Date();
    const timeStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);

    const row = {
      trade_date: tradeDate,
      trade_time: timeStr,
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
    };

    db.insertMinuteSnapshot(row);

    try {
      const ext = await depth.getExtendedQuote(secid);
      const margin = depth.buildMarginSnapshot(ext);
      if (margin.rzye != null || margin.rqye != null) {
        db.upsertMarginSnapshot({
          trade_date: tradeDate,
          code,
          rzye: margin.rzye,
          rqye: margin.rqye,
          rzrqye: margin.rzrqye,
          rqyl: margin.rqyl,
        });
      }
    } catch {
      /* optional */
    }

    return { ok: true, row, quote, code };
  } finally {
    collectingCodes.delete(s.code);
  }
}

async function collectWatchlist(force = false) {
  const list = db.getWatchlist();
  const results = [];
  for (const row of list) {
    const stock = resolveStockFromRecord(row);
    results.push(await collectOnce(stock, force));
  }
  return results;
}

async function syncDailyKlines(stock, days = 30) {
  const s = stock?.code ? stock : resolveStockFromRecord(stock);
  const { code, secid, market } = s;
  const klines = await api.getKlines(secid, 101, days, code, market);

  for (const k of klines) {
    const tradeDate = k.trade_time.slice(0, 10);
    db.upsertDailyQuote({
      trade_date: tradeDate,
      code,
      open: k.open,
      close: k.close,
      high: k.high,
      low: k.low,
      volume: k.volume,
      amount: k.amount,
      turnover_rate: k.turnover_rate,
      amplitude: k.amplitude,
      pct_change: k.pct_change,
      change: k.change,
    });
  }

  return { synced: klines.length, code };
}

async function syncTodayMinuteBars(stock) {
  const s = stock?.code ? stock : resolveStockFromRecord(stock);
  const { code, secid, market } = s;
  const tradeDate = api.todayStr();
  const klines = await api.getKlines(secid, 1, 240, code, market);

  let count = 0;
  for (const k of klines) {
    if (!k.trade_time.startsWith(tradeDate)) continue;
    const timePart = k.trade_time.includes(' ')
      ? k.trade_time.split(' ')[1]
      : k.trade_time;

    db.insertMinuteSnapshot({
      trade_date: tradeDate,
      trade_time: timePart.length === 5 ? `${timePart}:00` : timePart,
      code,
      price: k.close,
      open: k.open,
      high: k.high,
      low: k.low,
      pre_close: null,
      volume: k.volume,
      amount: k.amount,
      turnover_rate: k.turnover_rate,
      volume_ratio: null,
      amplitude: k.amplitude,
      pct_change: k.pct_change,
      change: k.change,
      main_net_inflow: null,
      large_net_inflow: null,
      super_large_net_inflow: null,
    });
    count++;
  }
  return { synced: count, code };
}

async function syncDragonTiger(stock, limit = 10) {
  const s = stock?.code ? stock : resolveStockFromRecord(stock);
  const { code } = s;
  const rows = await depth.getDragonTigerList(code, limit);
  for (const r of rows) {
    db.upsertLhbRecord({
      trade_date: r.trade_date,
      code,
      reason: r.reason || '',
      net_amount: r.net_amount,
      buy_amount: r.buy_amount,
      sell_amount: r.sell_amount,
      pct_change: r.pct_change,
      payload: JSON.stringify(r),
    });
  }
  return { synced: rows.length, code };
}

async function syncWatchlistDaily(days = 30) {
  const list = db.getWatchlist();
  const out = [];
  for (const row of list) {
    out.push(await syncDailyKlines(row, days));
  }
  return out;
}

async function syncWatchlistTodayMinutes() {
  const list = db.getWatchlist();
  const out = [];
  for (const row of list) {
    out.push(await syncTodayMinuteBars(row));
  }
  return out;
}

module.exports = {
  collectOnce,
  collectWatchlist,
  syncDailyKlines,
  syncTodayMinuteBars,
  syncDragonTiger,
  syncWatchlistDaily,
  syncWatchlistTodayMinutes,
};