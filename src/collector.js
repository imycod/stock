const config = require('../config');
const api = require('./api/eastmoney');
const db = require('./storage/database');
const depth = require('./api/marketDepth');

let collecting = false;

async function collectOnce(force = false) {
  if (collecting) return { skipped: true, reason: 'busy' };
  if (!force && !api.isTradingTime()) {
    return { skipped: true, reason: 'non_trading_hours' };
  }

  collecting = true;
  const { code, secid } = config.stock;
  const tradeDate = api.todayStr();

  try {
    const [quote, flow] = await Promise.all([
      api.getRealtimeQuote(secid, code, config.stock.market),
      api.getCapitalFlow(secid).catch(() => null),
    ]);

    if (!quote) {
      return { ok: false, error: 'quote_empty' };
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

    return { ok: true, row, quote };
  } finally {
    collecting = false;
  }
}

async function syncDailyKlines(days = 30) {
  const { code, secid, market } = config.stock;
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

  return { synced: klines.length };
}

async function syncTodayMinuteBars() {
  const { code, secid, market } = config.stock;
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
  return { synced: count };
}

async function syncDragonTiger(limit = 10) {
  const { code } = config.stock;
  const rows = await depth.getDragonTigerList(code, limit);
  for (const r of rows) {
    db.upsertLhbRecord({
      trade_date: r.trade_date,
      code,
      reason: r.reason || "",
      net_amount: r.net_amount,
      buy_amount: r.buy_amount,
      sell_amount: r.sell_amount,
      pct_change: r.pct_change,
      payload: JSON.stringify(r),
    });
  }
  return { synced: rows.length };
}

module.exports = {
  collectOnce,
  syncDailyKlines,
  syncTodayMinuteBars,
};
