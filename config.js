/** 默认标的与监控列表（启动时写入 watchlist 表；name 可手动填写，避免接口乱码） */
module.exports = {
  defaultStockCode: process.env.DEFAULT_STOCK || '600759',
  watchlist: [
    { code: '600759', name: '洲际油气' },
    { code: '600660', name: '福耀玻璃' },
    { code: '002129', name: 'TCL中环' },
    { code: '601212', name: '白银有色' },
    { code: '601899', name: '紫金矿业' },
  ],
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
