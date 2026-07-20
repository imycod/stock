/** 默认标的与监控列表（启动时写入 watchlist 表） */
module.exports = {
  defaultStockCode: process.env.DEFAULT_STOCK || '600759',
  /** 定时采集的股票代码列表 */
  watchlist: ['600759'],
  benchmark: {
    code: '000001',
    name: '上证指数',
    secid: '1.000001',
  },
  port: process.env.PORT || 3009,
  dataDir: './data',
  dbPath: './data/stock.db',
  collectCron: '5 * * * * *',
  dailySyncCron: '5 15 * * 1-5',
};