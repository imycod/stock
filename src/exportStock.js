/**
 * 单只股票历史数据导出（交互式）
 * 用法：pnpm run export:stock  或双击 export-stock.cmd
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const XLSX = require('xlsx');
const api = require('./api/eastmoney');
const depth = require('./api/marketDepth');
const { resolveStock } = require('./stocks');

const OUT_DIR = path.join(__dirname, '..', 'data', 'exports');

const DATA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://data.eastmoney.com/',
};

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(String(ans || '').trim());
    });
  });
}

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d);
}

function round(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '';
  return +v.toFixed(digits);
}

function sma(arr, period, idx) {
  if (idx < period - 1) return null;
  let s = 0;
  for (let i = idx - period + 1; i <= idx; i++) s += arr[i];
  return s / period;
}

function calcEMA(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function calcRSISeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  for (let i = period; i < closes.length; i++) {
    let gains = 0;
    let losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    out[i] = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  }
  return out;
}

function calcMACDSeries(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const dif = closes.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? ema12[i] - ema26[i] : null
  );
  const difVals = dif.filter((x) => x != null);
  const deaArr = calcEMA(difVals, 9);
  let di = 0;
  const dea = dif.map((d) => {
    if (d == null) return null;
    const v = deaArr[8 + di] ?? null;
    di++;
    return v;
  });
  const macd = dif.map((d, i) => (d != null && dea[i] != null ? (d - dea[i]) * 2 : null));
  return { dif, dea, macd };
}

function calcBOLL(closes, idx, period = 20) {
  if (idx < period - 1) return { upper: null, mid: null, lower: null };
  const slice = closes.slice(idx - period + 1, idx + 1);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, x) => s + (x - mid) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return { upper: mid + 2 * std, mid, lower: mid - 2 * std };
}

function calcOBV(closes, volumes) {
  const out = [];
  let obv = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      obv = volumes[i] || 0;
    } else if (closes[i] > closes[i - 1]) {
      obv += volumes[i] || 0;
    } else if (closes[i] < closes[i - 1]) {
      obv -= volumes[i] || 0;
    }
    out.push(obv);
  }
  return out;
}

async function fetchDailyCapitalFlow(secid, limit = 120) {
  const params = new URLSearchParams({
    lmt: String(limit),
    klt: '101',
    secid,
    fields1: 'f1,f2,f3,f7',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65',
    ut: 'fa5fd1943c7b386f172d6893dbfba107',
    _: String(Date.now()),
  });
  const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?${params}`;
  const res = await fetch(url, {
    headers: DATA_HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`资金流 HTTP ${res.status}`);
  const json = await res.json();
  const lines = json.data?.klines || [];
  return lines.map((line) => {
    const p = line.split(',');
    return {
      trade_date: p[0],
      main_net_inflow: +p[1],
      small_net_inflow: +p[2],
      medium_net_inflow: +p[3],
      large_net_inflow: +p[4],
      super_large_net_inflow: +p[5],
      main_net_pct: p[6] != null ? +p[6] : null,
      small_net_pct: p[7] != null ? +p[7] : null,
      medium_net_pct: p[8] != null ? +p[8] : null,
      large_net_pct: p[9] != null ? +p[9] : null,
      super_large_net_pct: p[10] != null ? +p[10] : null,
    };
  });
}

async function fetchMarginHistory(code, pageSize = 60) {
  const filter = encodeURIComponent(`(SECURITY_CODE="${code}")`);
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get?' +
    'reportName=RPT_MARGIN_DETAIL&columns=ALL' +
    `&filter=${filter}&pageNumber=1&pageSize=${pageSize}` +
    '&sortColumns=TRADE_DATE&sortTypes=-1';
  const res = await fetch(url, {
    headers: DATA_HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.result?.data || []).map((r) => ({
    trade_date: String(r.TRADE_DATE || '').slice(0, 10),
    rzye: r.RZYE,
    rqye: r.RQYE,
    rzmre: r.RZMRE,
    rzche: r.RZCHE,
    rqmcl: r.RQMCL,
    rqchl: r.RQCHL,
    rzrqye: r.RZRQYE,
  }));
}

function enrichDailyRows(klines) {
  const closes = klines.map((k) => k.close);
  const volumes = klines.map((k) => k.volume);
  const rsi = calcRSISeries(closes, 14);
  const { dif, dea, macd } = calcMACDSeries(closes);
  const obv = calcOBV(closes, volumes);

  return klines.map((k, i) => {
    const boll = calcBOLL(closes, i, 20);
    const preClose = i > 0 ? closes[i - 1] : null;
    return {
      日期: k.trade_time.slice(0, 10),
      开盘价: round(k.open, 3),
      收盘价: round(k.close, 3),
      最高价: round(k.high, 3),
      最低价: round(k.low, 3),
      昨收: preClose != null ? round(preClose, 3) : '',
      涨跌额: round(k.change, 3),
      涨跌幅pct: round(k.pct_change),
      振幅pct: round(k.amplitude),
      成交量: k.volume ? Math.round(k.volume) : '',
      成交额: k.amount ? Math.round(k.amount) : '',
      换手率pct: round(k.turnover_rate),
      MA5: round(sma(closes, 5, i), 3),
      MA10: round(sma(closes, 10, i), 3),
      MA20: round(sma(closes, 20, i), 3),
      MA60: round(sma(closes, 60, i), 3),
      量MA5: round(sma(volumes, 5, i), 0),
      量MA10: round(sma(volumes, 10, i), 0),
      RSI14: round(rsi[i]),
      MACD_DIF: round(dif[i], 4),
      MACD_DEA: round(dea[i], 4),
      MACD柱: round(macd[i], 4),
      BOLL上轨: round(boll.upper, 3),
      BOLL中轨: round(boll.mid, 3),
      BOLL下轨: round(boll.lower, 3),
      OBV: obv[i] != null ? Math.round(obv[i]) : '',
    };
  });
}

function filterByDateRange(rows, dateKey, startDate, endDate) {
  return rows.filter((r) => {
    const d = String(r[dateKey] || r.trade_date || '').slice(0, 10);
    return d >= startDate && d <= endDate;
  });
}

function buildFlowSheet(rows) {
  return rows.map((r) => ({
    日期: r.trade_date?.slice(0, 10) || r.trade_date,
    主力净流入: round(r.main_net_inflow, 0),
    超大单净流入: round(r.super_large_net_inflow, 0),
    大单净流入: round(r.large_net_inflow, 0),
    中单净流入: round(r.medium_net_inflow, 0),
    小单净流入: round(r.small_net_inflow, 0),
    主力净占比pct: round(r.main_net_pct),
    超大单净占比pct: round(r.super_large_net_pct),
    大单净占比pct: round(r.large_net_pct),
  }));
}

function buildLhbSheet(rows) {
  return rows.map((r) => ({
    日期: r.trade_date,
    收盘价: round(r.close, 3),
    涨跌幅pct: round(r.pct_change),
    换手率pct: round(r.turnover_rate),
    龙虎榜净买额: round(r.net_amount, 0),
    买入额: round(r.buy_amount, 0),
    卖出额: round(r.sell_amount, 0),
    净买占比pct: round(r.deal_net_ratio),
    上榜原因: r.reason || '',
  }));
}

function buildMarginSheet(rows) {
  return rows.map((r) => ({
    日期: r.trade_date,
    融资余额: r.rzye != null ? Math.round(r.rzye) : '',
    融券余额: r.rqye != null ? Math.round(r.rqye) : '',
    融资融券余额: r.rzrqye != null ? Math.round(r.rzrqye) : '',
    融资买入额: r.rzmre != null ? Math.round(r.rzmre) : '',
    融资偿还额: r.rzche != null ? Math.round(r.rzche) : '',
    融券卖出量: r.rqmcl != null ? Math.round(r.rqmcl) : '',
    融券偿还量: r.rqchl != null ? Math.round(r.rqchl) : '',
  }));
}

function writeWorkbook(data, outPath) {
  const wb = XLSX.utils.book_new();

  const addSheet = (name, rows) => {
    const ws = rows.length
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['暂无数据']]);
    if (rows.length) {
      const keys = Object.keys(rows[0]);
      ws['!cols'] = keys.map((k) => ({
        wch: Math.min(22, Math.max(8, String(k).length + 2)),
      }));
    }
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  addSheet('日线行情', data.daily);
  addSheet('资金流向', data.flow);
  addSheet('龙虎榜', data.lhb);
  addSheet('融资融券', data.margin);
  addSheet('实时快照', [data.snapshot]);

  const meta = [
    ['导出时间', data.meta.exportTime],
    ['股票代码', data.meta.code],
    ['股票名称', data.meta.name],
    ['市场', data.meta.market],
    ['导出天数', data.meta.days],
    ['起始日期', data.meta.startDate],
    ['结束日期', data.meta.endDate],
    ['日线条数', data.daily.length],
    ['龙虎榜条数', data.lhb.length],
    ['数据源', '东方财富 / 新浪 / 腾讯 公开接口'],
    ['说明', '技术指标(MACD/RSI/BOLL/OBV)由日线收盘价与成交量计算'],
    ['', ''],
    ['量化关注指标说明', ''],
    ['换手率', '反映筹码交换活跃度，配合放量突破更有效'],
    ['量比/量能', '相对历史均量的放大倍数，验证趋势真假'],
    ['主力净流入', '大单+超大单方向，短线情绪核心'],
    ['MA均线', '趋势方向与支撑阻力'],
    ['MACD', '趋势动量与金叉死叉'],
    ['RSI', '超买超卖，14日常用'],
    ['BOLL', '波动区间与突破信号'],
    ['OBV', '量价配合，确认趋势'],
    ['龙虎榜', '游资/机构席位异动，短线重要参考'],
    ['融资融券', '杠杆资金态度，趋势延续或反转信号'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), '导出说明');

  XLSX.writeFile(wb, outPath);
}

async function exportStock(codeInput, daysInput) {
  const stock = await resolveStock(codeInput);
  const { code, market, secid } = stock;
  let name = stock.name || '';
  try {
    const quote = await api.getRealtimeQuote(secid, code, market);
    if (quote.name) name = quote.name;
  } catch {
    /* optional */
  }

  const days = Math.max(1, Math.min(365, parseInt(daysInput, 10) || 30));
  const endDate = todayStr();
  const startDate = daysAgo(days);
  const fetchLimit = Math.min(365, days + 80);

  console.log(`\n正在拉取 ${code} ${name} 近 ${days} 天数据 (${startDate} ~ ${endDate})...\n`);

  const [klines, flow, lhbAll, marginAll, extQuote] = await Promise.all([
    api.getKlines(secid, 101, fetchLimit, code, market),
    fetchDailyCapitalFlow(secid, fetchLimit).catch(() => []),
    depth.getDragonTigerList(code, 50).catch(() => []),
    fetchMarginHistory(code, fetchLimit).catch(() => []),
    depth.getExtendedQuote(secid).catch(() => ({})),
  ]);

  const daily = enrichDailyRows(
    klines.filter((k) => k.trade_time.slice(0, 10) <= endDate)
  ).filter((r) => r.日期 >= startDate && r.日期 <= endDate);

  const flowRows = buildFlowSheet(
    filterByDateRange(flow, 'trade_date', startDate, endDate)
  );

  const lhb = buildLhbSheet(
    lhbAll.filter((r) => r.trade_date >= startDate && r.trade_date <= endDate)
  );

  const margin = buildMarginSheet(
    marginAll.filter((r) => r.trade_date >= startDate && r.trade_date <= endDate)
  );

  let snapshot = {};
  try {
    const q = await api.getRealtimeQuote(secid, code, market);
    snapshot = {
      代码: code,
      名称: name || q.name,
      最新价: round(q.price, 3),
      开盘价: round(q.open, 3),
      最高价: round(q.high, 3),
      最低价: round(q.low, 3),
      昨收: round(q.pre_close, 3),
      涨跌幅pct: round(q.pct_change),
      成交量: q.volume ? Math.round(q.volume) : '',
      成交额: q.amount ? Math.round(q.amount) : '',
      换手率pct: round(q.turnover_rate),
      量比: round(q.volume_ratio),
      振幅pct: round(q.amplitude),
      PE: round(q.pe),
      PB: round(q.pb),
      总市值: extQuote.f116 != null ? Math.round(extQuote.f116) : '',
      流通市值: extQuote.f117 != null ? Math.round(extQuote.f117) : '',
      更新时间: q.updated_at || new Date().toISOString(),
    };
  } catch {
    snapshot = { 代码: code, 名称: name, 备注: '实时行情暂不可用' };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-');
  const safeName = (name || code).replace(/[\\/:*?"<>|]/g, '_');
  const outPath = path.join(OUT_DIR, `${code}_${safeName}_${days}d_${stamp}.xlsx`);

  writeWorkbook(
    {
      daily,
      flow: flowRows,
      lhb,
      margin,
      snapshot,
      meta: {
        exportTime: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        code,
        name: name || code,
        market,
        days,
        startDate,
        endDate,
      },
    },
    outPath
  );

  console.log('导出完成！');
  console.log(`  股票: ${code} ${name}`);
  console.log(`  区间: ${startDate} ~ ${endDate} (${days} 天)`);
  console.log(`  日线: ${daily.length} 条`);
  console.log(`  资金流: ${flowRows.length} 条`);
  console.log(`  龙虎榜: ${lhb.length} 条`);
  console.log(`  融资融券: ${margin.length} 条`);
  console.log(`  文件: ${outPath}\n`);

  return outPath;
}

async function main() {
  console.log('');
  console.log('========================================');
  console.log('       股票历史数据导出工具');
  console.log('========================================');
  console.log('');
  console.log('将导出指定股票近 N 天的：');
  console.log('  日线(开高低收/量额/换手) + MA/MACD/RSI/BOLL/OBV');
  console.log('  每日主力资金流向、龙虎榜、融资融券');
  console.log('');

  const codeInput = await ask('请输入股票代码 (如 600759): ');
  if (!codeInput) {
    console.error('未输入股票代码，已退出。');
    process.exit(1);
  }

  const daysInput = await ask('请输入导出天数 (默认 30): ');
  const days = daysInput || '30';

  try {
    await exportStock(codeInput, days);
  } catch (e) {
    console.error('\n导出失败:', e.message || e);
    process.exit(1);
  }
}

module.exports = { exportStock, enrichDailyRows };

if (require.main === module) {
  main();
}
