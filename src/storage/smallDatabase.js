const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../../config');

let db;

function dbPath() {
  return path.resolve(config.smallLive?.dbPath || './data/small-live.db');
}

function getDb() {
  if (db) return db;
  const p = dbPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  db = new Database(p);
  db.pragma('journal_mode = WAL');
  initSchema();
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      code TEXT PRIMARY KEY,
      name TEXT,
      market TEXT NOT NULL,
      secid TEXT NOT NULL,
      source TEXT,
      active INTEGER DEFAULT 1,
      added_at TEXT DEFAULT (datetime('now','localtime')),
      last_polled_at TEXT,
      last_lhb_sync TEXT
    );

    CREATE TABLE IF NOT EXISTS minute_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL,
      trade_time TEXT NOT NULL,
      code TEXT NOT NULL,
      price REAL,
      open REAL,
      high REAL,
      low REAL,
      pre_close REAL,
      volume REAL,
      amount REAL,
      turnover_rate REAL,
      volume_ratio REAL,
      amplitude REAL,
      pct_change REAL,
      change REAL,
      main_net_inflow REAL,
      large_net_inflow REAL,
      super_large_net_inflow REAL,
      active_buy_volume REAL,
      active_sell_volume REAL,
      tick_count INTEGER,
      main_buy REAL,
      main_sell REAL,
      main_net REAL,
      super_large_buy REAL,
      super_large_sell REAL,
      large_buy REAL,
      large_sell REAL,
      payload TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(trade_date, trade_time, code)
    );

    CREATE TABLE IF NOT EXISTS lhb_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL,
      code TEXT NOT NULL,
      reason TEXT,
      net_amount REAL,
      buy_amount REAL,
      sell_amount REAL,
      pct_change REAL,
      payload TEXT,
      UNIQUE(trade_date, code, reason)
    );

    CREATE TABLE IF NOT EXISTS fundamentals (
      code TEXT PRIMARY KEY,
      name TEXT,
      payload TEXT,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_small_minute_date ON minute_snapshots(trade_date, code);
    CREATE INDEX IF NOT EXISTS idx_small_minute_code ON minute_snapshots(code, id DESC);
  `);
}

function upsertWatchlistStock(row) {
  const stmt = getDb().prepare(`
    INSERT INTO watchlist (code, name, market, secid, source, active)
    VALUES (@code, @name, @market, @secid, @source, COALESCE(@active, 1))
    ON CONFLICT(code) DO UPDATE SET
      name=COALESCE(excluded.name, watchlist.name),
      market=excluded.market,
      secid=excluded.secid,
      source=COALESCE(excluded.source, watchlist.source),
      active=COALESCE(excluded.active, watchlist.active)
  `);
  return stmt.run({
    code: row.code,
    name: row.name || null,
    market: row.market,
    secid: row.secid,
    source: row.source || 'manual',
    active: row.active == null ? 1 : row.active ? 1 : 0,
  });
}

function getWatchlist(activeOnly = true) {
  if (activeOnly) {
    return getDb()
      .prepare(
        'SELECT code, name, market, secid, source, active, added_at, last_polled_at, last_lhb_sync FROM watchlist WHERE active = 1 ORDER BY code'
      )
      .all();
  }
  return getDb()
    .prepare(
      'SELECT code, name, market, secid, source, active, added_at, last_polled_at, last_lhb_sync FROM watchlist ORDER BY code'
    )
    .all();
}

function getWatchlistStock(code) {
  return getDb()
    .prepare(
      'SELECT code, name, market, secid, source, active, added_at, last_polled_at, last_lhb_sync FROM watchlist WHERE code = ?'
    )
    .get(code);
}

function markPolled(code) {
  return getDb()
    .prepare(
      "UPDATE watchlist SET last_polled_at = datetime('now','localtime') WHERE code = ?"
    )
    .run(code);
}

function markLhbSynced(code) {
  return getDb()
    .prepare(
      "UPDATE watchlist SET last_lhb_sync = datetime('now','localtime') WHERE code = ?"
    )
    .run(code);
}

function trimWatchlist(max) {
  if (!max || max <= 0) return 0;
  const rows = getDb()
    .prepare('SELECT code FROM watchlist WHERE active = 1 ORDER BY added_at DESC')
    .all();
  if (rows.length <= max) return 0;
  const drop = rows.slice(max).map((r) => r.code);
  const stmt = getDb().prepare('UPDATE watchlist SET active = 0 WHERE code = ?');
  const tx = getDb().transaction((codes) => {
    for (const c of codes) stmt.run(c);
  });
  tx(drop);
  return drop.length;
}

function insertMinuteSnapshot(row) {
  const stmt = getDb().prepare(`
    INSERT INTO minute_snapshots (
      trade_date, trade_time, code, price, open, high, low, pre_close,
      volume, amount, turnover_rate, volume_ratio, amplitude, pct_change, change,
      main_net_inflow, large_net_inflow, super_large_net_inflow,
      active_buy_volume, active_sell_volume, tick_count,
      main_buy, main_sell, main_net,
      super_large_buy, super_large_sell, large_buy, large_sell, payload
    ) VALUES (
      @trade_date, @trade_time, @code, @price, @open, @high, @low, @pre_close,
      @volume, @amount, @turnover_rate, @volume_ratio, @amplitude, @pct_change, @change,
      @main_net_inflow, @large_net_inflow, @super_large_net_inflow,
      @active_buy_volume, @active_sell_volume, @tick_count,
      @main_buy, @main_sell, @main_net,
      @super_large_buy, @super_large_sell, @large_buy, @large_sell, @payload
    )
    ON CONFLICT(trade_date, trade_time, code) DO UPDATE SET
      price=excluded.price, open=excluded.open, high=excluded.high, low=excluded.low,
      volume=excluded.volume, amount=excluded.amount,
      turnover_rate=excluded.turnover_rate, volume_ratio=excluded.volume_ratio,
      amplitude=excluded.amplitude, pct_change=excluded.pct_change, change=excluded.change,
      main_net_inflow=excluded.main_net_inflow,
      large_net_inflow=excluded.large_net_inflow,
      super_large_net_inflow=excluded.super_large_net_inflow,
      active_buy_volume=excluded.active_buy_volume,
      active_sell_volume=excluded.active_sell_volume,
      tick_count=excluded.tick_count,
      main_buy=excluded.main_buy, main_sell=excluded.main_sell, main_net=excluded.main_net,
      super_large_buy=excluded.super_large_buy, super_large_sell=excluded.super_large_sell,
      large_buy=excluded.large_buy, large_sell=excluded.large_sell,
      payload=excluded.payload
  `);
  return stmt.run({
    trade_date: row.trade_date,
    trade_time: row.trade_time,
    code: row.code,
    price: row.price ?? null,
    open: row.open ?? null,
    high: row.high ?? null,
    low: row.low ?? null,
    pre_close: row.pre_close ?? null,
    volume: row.volume ?? null,
    amount: row.amount ?? null,
    turnover_rate: row.turnover_rate ?? null,
    volume_ratio: row.volume_ratio ?? null,
    amplitude: row.amplitude ?? null,
    pct_change: row.pct_change ?? null,
    change: row.change ?? null,
    main_net_inflow: row.main_net_inflow ?? null,
    large_net_inflow: row.large_net_inflow ?? null,
    super_large_net_inflow: row.super_large_net_inflow ?? null,
    active_buy_volume: row.active_buy_volume ?? null,
    active_sell_volume: row.active_sell_volume ?? null,
    tick_count: row.tick_count ?? null,
    main_buy: row.main_buy ?? null,
    main_sell: row.main_sell ?? null,
    main_net: row.main_net ?? null,
    super_large_buy: row.super_large_buy ?? null,
    super_large_sell: row.super_large_sell ?? null,
    large_buy: row.large_buy ?? null,
    large_sell: row.large_sell ?? null,
    payload: row.payload ?? null,
  });
}

function getLatestSnapshot(code) {
  return getDb()
    .prepare(
      `SELECT * FROM minute_snapshots WHERE code = ? ORDER BY trade_date DESC, trade_time DESC, id DESC LIMIT 1`
    )
    .get(code);
}

function getLatestSnapshots(codes = null) {
  if (Array.isArray(codes) && codes.length) {
    const placeholders = codes.map(() => '?').join(',');
    return getDb()
      .prepare(
        `SELECT s.* FROM minute_snapshots s
         INNER JOIN (
           SELECT code, MAX(id) AS mid FROM minute_snapshots
           WHERE code IN (${placeholders}) GROUP BY code
         ) t ON s.id = t.mid`
      )
      .all(...codes);
  }
  return getDb()
    .prepare(
      `SELECT s.* FROM minute_snapshots s
       INNER JOIN (
         SELECT code, MAX(id) AS mid FROM minute_snapshots GROUP BY code
       ) t ON s.id = t.mid
       ORDER BY s.code`
    )
    .all();
}

function getMinuteSnapshots(code, tradeDate, limit = 500) {
  if (tradeDate) {
    return getDb()
      .prepare(
        `SELECT * FROM minute_snapshots
         WHERE code = ? AND trade_date = ?
         ORDER BY trade_time ASC LIMIT ?`
      )
      .all(code, tradeDate, limit);
  }
  return getDb()
    .prepare(
      `SELECT * FROM minute_snapshots WHERE code = ?
       ORDER BY trade_date DESC, trade_time DESC LIMIT ?`
    )
    .all(code, limit);
}

function upsertLhbRecord(row) {
  const stmt = getDb().prepare(`
    INSERT INTO lhb_records (
      trade_date, code, reason, net_amount, buy_amount, sell_amount, pct_change, payload
    ) VALUES (
      @trade_date, @code, @reason, @net_amount, @buy_amount, @sell_amount, @pct_change, @payload
    )
    ON CONFLICT(trade_date, code, reason) DO UPDATE SET
      net_amount=excluded.net_amount, buy_amount=excluded.buy_amount,
      sell_amount=excluded.sell_amount, pct_change=excluded.pct_change,
      payload=excluded.payload
  `);
  return stmt.run({
    trade_date: row.trade_date,
    code: row.code,
    reason: row.reason || '',
    net_amount: row.net_amount ?? null,
    buy_amount: row.buy_amount ?? null,
    sell_amount: row.sell_amount ?? null,
    pct_change: row.pct_change ?? null,
    payload: row.payload ?? null,
  });
}

function getLhbRecords(code, limit = 10) {
  return getDb()
    .prepare(
      `SELECT * FROM lhb_records WHERE code = ? ORDER BY trade_date DESC LIMIT ?`
    )
    .all(code, limit);
}

function upsertFundamentals(code, name, payloadObj) {
  const stmt = getDb().prepare(`
    INSERT INTO fundamentals (code, name, payload, updated_at)
    VALUES (@code, @name, @payload, datetime('now','localtime'))
    ON CONFLICT(code) DO UPDATE SET
      name=excluded.name, payload=excluded.payload, updated_at=excluded.updated_at
  `);
  return stmt.run({
    code,
    name: name || null,
    payload: JSON.stringify(payloadObj || {}),
  });
}

function getFundamentals(code) {
  const row = getDb().prepare('SELECT * FROM fundamentals WHERE code = ?').get(code);
  if (!row) return null;
  let payload = null;
  try {
    payload = JSON.parse(row.payload || '{}');
  } catch {
    payload = {};
  }
  return { code: row.code, name: row.name, payload, updated_at: row.updated_at };
}

function getStats() {
  const watchCount = getDb().prepare('SELECT COUNT(*) AS c FROM watchlist WHERE active = 1').get().c;
  const snapCount = getDb().prepare('SELECT COUNT(*) AS c FROM minute_snapshots').get().c;
  const lastSnap = getDb()
    .prepare(
      'SELECT trade_date, trade_time, price, code FROM minute_snapshots ORDER BY id DESC LIMIT 1'
    )
    .get();
  return { watchCount, snapCount, lastSnap, dbPath: dbPath() };
}

module.exports = {
  getDb,
  dbPath,
  upsertWatchlistStock,
  getWatchlist,
  getWatchlistStock,
  markPolled,
  markLhbSynced,
  trimWatchlist,
  insertMinuteSnapshot,
  getLatestSnapshot,
  getLatestSnapshots,
  getMinuteSnapshots,
  upsertLhbRecord,
  getLhbRecords,
  upsertFundamentals,
  getFundamentals,
  getStats,
};
