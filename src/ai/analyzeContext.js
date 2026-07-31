const smallDb = require('../storage/smallDatabase');
const { aiConfig } = require('./zhipu');

function num(v, d = 4) {
  if (v == null || v === '' || Number.isNaN(Number(v))) return '';
  return Number(Number(v).toFixed(d));
}

function buildSnapshotContext(code, days = 5) {
  const c = aiConfig();
  const dayN = Math.min(Math.max(1, Number(days) || c.defaultDays), c.maxDays);
  const watch = smallDb.getWatchlistStock(code);
  const fund = smallDb.getFundamentals(code);
  const name = watch?.name || fund?.name || code;
  const dates = smallDb.getSnapshotDates(code).slice(0, dayN);
  const rows = [];
  for (const d of dates.slice().reverse()) {
    // chronological for model
    const dayRows = smallDb.getMinuteSnapshots(code, d.tradeDate, 1000);
    for (const r of dayRows) rows.push(r);
  }
  const limited = rows.length > c.maxRows ? rows.slice(rows.length - c.maxRows) : rows;

  const header =
    'trade_date,trade_time,price,pct_change,volume,amount,turnover_rate,volume_ratio,amplitude,main_net_inflow,large_net_inflow,active_buy_volume,active_sell_volume,main_buy,main_sell,main_net';
  const lines = limited.map((r) =>
    [
      r.trade_date,
      r.trade_time,
      num(r.price, 3),
      num(r.pct_change, 3),
      num(r.volume, 2),
      num(r.amount, 0),
      num(r.turnover_rate, 3),
      num(r.volume_ratio, 3),
      num(r.amplitude, 3),
      num(r.main_net_inflow, 0),
      num(r.large_net_inflow, 0),
      num(r.active_buy_volume, 0),
      num(r.active_sell_volume, 0),
      num(r.main_buy, 0),
      num(r.main_sell, 0),
      num(r.main_net, 0),
    ].join(',')
  );

  const meta = {
    code,
    name,
    days: dayN,
    dateList: dates.map((d) => d.tradeDate),
    rowCount: limited.length,
    totalAvailable: rows.length,
    truncated: rows.length > limited.length,
  };

  const text =
    `股票: ${code} ${name}\n` +
    `数据范围: 近 ${dayN} 个有快照的交易日 (${meta.dateList.join(', ') || '无'})\n` +
    `分钟快照条数: ${meta.rowCount}` +
    (meta.truncated ? ` (已截断，原始 ${meta.totalAvailable})` : '') +
    `\n字段说明: volume/amount 为累计或接口原值；active_buy/sell 为窗口内主动买卖量摘要；main_* 为主力/大单相关。\n` +
    `CSV:\n${header}\n${lines.join('\n')}`;

  return { meta, text };
}

function systemPrompt() {
  return [
    '你是一名 A 股分时与资金流研究助手。',
    '用户会提供某只股票近几日的分钟级快照（价、量、额、换手、量比、主力净流入、主动买卖等）。',
    '请基于数据回答：主力意图、集合竞价特征、出货/洗盘研判、短时量能换手判断等。',
    '要求：结论明确、分点论述、引用具体时间段或数值；若数据不足请直说。',
    '仅供研究参考，不构成投资建议，不要给出具体买卖指令或目标价承诺。',
  ].join('');
}

module.exports = {
  buildSnapshotContext,
  systemPrompt,
};
