const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../../config');

let db;

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  initSchema();
  return db;
}

function initSchema() {
  db.exec(`
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
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(trade_date, trade_time, code)
    );

    CREATE TABLE IF NOT EXISTS daily_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL,
      code TEXT NOT NULL,
      open REAL,
      close REAL,
      high REAL,
      low REAL,
      volume REAL,
      amount REAL,
      turnover_rate REAL,
      amplitude REAL,
      pct_change REAL,
      change REAL,
      UNIQUE(trade_date, code)
    );

    CREATE TABLE IF NOT EXISTS analysis_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL,
      code TEXT NOT NULL,
      horizon TEXT NOT NULL,
      trend TEXT NOT NULL,
      score REAL,
      confidence REAL,
      reasons TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(trade_date, code, horizon)
    );

    CREATE INDEX IF NOT EXISTS idx_minute_date ON minute_snapshots(trade_date, code);
    CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_quotes(trade_date, code);

    CREATE TABLE IF NOT EXISTS margin_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL,
      code TEXT NOT NULL,
      rzye REAL,
      rqye REAL,
      rzrqye REAL,
      rqyl REAL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(trade_date, code)
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      code TEXT PRIMARY KEY,
      name TEXT,
      market TEXT NOT NULL,
      secid TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
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
  `);
}

function insertMinuteSnapshot(row) {
  const stmt = getDb().prepare(`
    INSERT INTO minute_snapshots (
      trade_date, trade_time, code, price, open, high, low, pre_close,
      volume, amount, turnover_rate, volume_ratio, amplitude, pct_change, change,
      main_net_inflow, large_net_inflow, super_large_net_inflow
    ) VALUES (
      @trade_date, @trade_time, @code, @price, @open, @high, @low, @pre_close,
      @volume, @amount, @turnover_rate, @volume_ratio, @amplitude, @pct_change, @change,
      @main_net_inflow, @large_net_inflow, @super_large_net_inflow
    )
    ON CONFLICT(trade_date, trade_time, code) DO UPDATE SET
      price=excluded.price, volume=excluded.volume, amount=excluded.amount,
      turnover_rate=excluded.turnover_rate, volume_ratio=excluded.volume_ratio,
      amplitude=excluded.amplitude, pct_change=excluded.pct_change,
      main_net_inflow=excluded.main_net_inflow
  `);
  return stmt.run(row);
}

function upsertDailyQuote(row) {
  const stmt = getDb().prepare(`
    INSERT INTO daily_quotes (
      trade_date, code, open, close, high, low, volume, amount,
      turnover_rate, amplitude, pct_change, change
    ) VALUES (
      @trade_date, @code, @open, @close, @high, @low, @volume, @amount,
      @turnover_rate, @amplitude, @pct_change, @change
    )
    ON CONFLICT(trade_date, code) DO UPDATE SET
      close=excluded.close, high=excluded.high, low=excluded.low,
      volume=excluded.volume, amount=excluded.amount,
      turnover_rate=excluded.turnover_rate, amplitude=excluded.amplitude,
      pct_change=excluded.pct_change
  `);
  return stmt.run(row);
}

function upsertSignal(row) {
  const stmt = getDb().prepare(`
    INSERT INTO analysis_signals (trade_date, code, horizon, trend, score, confidence, reasons)
    VALUES (@trade_date, @code, @horizon, @trend, @score, @confidence, @reasons)
    ON CONFLICT(trade_date, code, horizon) DO UPDATE SET
      trend=excluded.trend, score=excluded.score,
      confidence=excluded.confidence, reasons=excluded.reasons
  `);
  return stmt.run(row);
}

function getMinuteSnapshots(tradeDate, code, limit = 500) {
  return getDb()
    .prepare(
      `SELECT * FROM minute_snapshots
       WHERE trade_date = ? AND code = ?
       ORDER BY trade_time ASC LIMIT ?`
    )
    .all(tradeDate, code, limit);
}

function getDailyQuotes(code, limit = 60) {
  return getDb()
    .prepare(
      `SELECT * FROM daily_quotes WHERE code = ?
       ORDER BY trade_date DESC LIMIT ?`
    )
    .all(code, limit)
    .reverse();
}

function getLatestSignals(tradeDate, code) {
  return getDb()
    .prepare(
      `SELECT * FROM analysis_signals
       WHERE trade_date = ? AND code = ?
       ORDER BY horizon`
    )
    .all(tradeDate, code);
}

function getWatchlist() {
  return getDb()
    .prepare("SELECT code, name, market, secid FROM watchlist ORDER BY code")
    .all();
}

function getWatchlistStock(code) {
  return getDb()
    .prepare("SELECT code, name, market, secid FROM watchlist WHERE code = ?")
    .get(code);
}

function upsertWatchlistStock(row) {
  const stmt = getDb().prepare(`
    INSERT INTO watchlist (code, name, market, secid)
    VALUES (@code, @name, @market, @secid)
    ON CONFLICT(code) DO UPDATE SET
      name=excluded.name, market=excluded.market, secid=excluded.secid
  `);
  return stmt.run(row);
}

function getStats(code) {
  if (code) {
    const minuteCount = getDb()
      .prepare("SELECT COUNT(*) AS c FROM minute_snapshots WHERE code = ?")
      .get(code).c;
    const dailyCount = getDb()
      .prepare("SELECT COUNT(*) AS c FROM daily_quotes WHERE code = ?")
      .get(code).c;
    const lastSnap = getDb()
      .prepare(
        `SELECT trade_date, trade_time, price, code FROM minute_snapshots
         WHERE code = ? ORDER BY id DESC LIMIT 1`
      )
      .get(code);
    return { minuteCount, dailyCount, lastSnap, code };
  }

  const minuteCount = getDb()
    .prepare("SELECT COUNT(*) AS c FROM minute_snapshots")
    .get().c;
  const dailyCount = getDb()
    .prepare("SELECT COUNT(*) AS c FROM daily_quotes")
    .get().c;
  const lastSnap = getDb()
    .prepare(
      "SELECT trade_date, trade_time, price, code FROM minute_snapshots ORDER BY id DESC LIMIT 1"
    )
    .get();
  const byStock = getDb()
    .prepare(
      `SELECT code, COUNT(*) AS minuteCount FROM minute_snapshots GROUP BY code ORDER BY code`
    )
    .all();
  return { minuteCount, dailyCount, lastSnap, byStock };
}

function getStatsLegacy() {
  const minuteCount = getDb()
    .prepare('SELECT COUNT(*) AS c FROM minute_snapshots')
    .get().c;
  const dailyCount = getDb()
    .prepare('SELECT COUNT(*) AS c FROM daily_quotes')
    .get().c;
  const lastSnap = getDb()
    .prepare(
      'SELECT trade_date, trade_time, price FROM minute_snapshots ORDER BY id DESC LIMIT 1'
    )
    .get();
  return { minuteCount, dailyCount, lastSnap };
}

function upsertMarginSnapshot(row) {
  const stmt = getDb().prepare(`
    INSERT INTO margin_snapshots (trade_date, code, rzye, rqye, rzrqye, rqyl)
    VALUES (@trade_date, @code, @rzye, @rqye, @rzrqye, @rqyl)
    ON CONFLICT(trade_date, code) DO UPDATE SET
      rzye=excluded.rzye, rqye=excluded.rqye,
      rzrqye=excluded.rzrqye, rqyl=excluded.rqyl
  `);
  return stmt.run(row);
}

function getMarginSnapshots(code, limit = 30) {
  return getDb()
    .prepare(
      `SELECT * FROM margin_snapshots WHERE code = ?
       ORDER BY trade_date DESC LIMIT ?`
    )
    .all(code, limit)
    .reverse();
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
  return stmt.run(row);
}

function getLhbRecords(code, limit = 10) {
  return getDb()
    .prepare(
      `SELECT * FROM lhb_records WHERE code = ?
       ORDER BY trade_date DESC LIMIT ?`
    )
    .all(code, limit);
}

module.exports = {
  getDb,
  insertMinuteSnapshot,
  upsertDailyQuote,
  upsertSignal,
  getMinuteSnapshots,
  getDailyQuotes,
  getLatestSignals,
  getStats,
};
