const iconv = require('iconv-lite');

/**
 * 东方财富公开行情 API（无需密钥）
 * 文档参考: push2 / push2his 接口
 */

const BASE_QUOTE = 'https://push2.eastmoney.com/api/qt/stock/get';
const BASE_KLINE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const BASE_FLOW = 'https://push2.eastmoney.com/api/qt/stock/fflow/kline/get';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://quote.eastmoney.com/',
};

const FETCH_OPTS = {
  headers: HEADERS,
  signal: AbortSignal.timeout(8000),
};

async function fetchJson(url, timeoutMs = 8000) {
  const res = await fetch(url, {
    ...FETCH_OPTS,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function fetchBuffer(url, headers = HEADERS, timeoutMs = 8000) {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchText(url, headers = HEADERS, timeoutMs = 8000, encoding = "utf8") {
  const buf = await fetchBuffer(url, headers, timeoutMs);
  if (encoding === "gbk" || encoding === "gb18030") {
    return iconv.decode(buf, "gb18030");
  }
  return buf.toString("utf8");
}

/** 新浪实时行情（备用，无需密钥） */
async function getSinaQuote(code, market = 'SH') {
  const prefix = market === 'SH' ? 'sh' : 'sz';
  const url = `https://hq.sinajs.cn/list=${prefix}${code}`;
  const text = await fetchText(
    url,
    {
      ...HEADERS,
      Referer: 'https://finance.sina.com.cn/',
    },
    8000,
    'gb18030'
  );
  const match = text.match(/="([^"]*)"/);
  if (!match || !match[1]) return null;

  const p = match[1].split(',');
  if (p.length < 32) return null;

  const price = +p[3];
  const preClose = +p[2];
  const change = price - preClose;
  const pctChange = preClose ? (change / preClose) * 100 : 0;
  const high = +p[4];
  const low = +p[5];
  const amplitude = preClose ? ((high - low) / preClose) * 100 : 0;

  return {
    code,
    name: p[0],
    price,
    open: +p[1],
    high,
    low,
    pre_close: preClose,
    volume: +p[8] / 100,
    amount: +p[9],
    volume_ratio: null,
    turnover_rate: null,
    change,
    pct_change: pctChange,
    amplitude,
    pe: null,
    pb: null,
    updated_at: new Date().toISOString(),
    source: 'sina',
  };
}

/** 腾讯实时行情（备用） */
async function getTencentQuote(code, market = 'SH') {
  const prefix = market === 'SH' ? 'sh' : 'sz';
  const url = `https://qt.gtimg.cn/q=${prefix}${code}`;
  const text = await fetchText(url, { ...HEADERS, Referer: 'https://gu.qq.com/' });
  const match = text.match(/="([^"]*)"/);
  if (!match || !match[1]) return null;

  const p = match[1].split('~');
  if (p.length < 40) return null;

  const price = +p[3];
  const preClose = +p[4];
  const change = +p[31];
  const pctChange = +p[32];

  return {
    code: p[2],
    name: p[1],
    price,
    open: +p[5],
    high: +p[33],
    low: +p[34],
    pre_close: preClose,
    volume: +p[6],
    amount: +p[37] * 10000,
    volume_ratio: +p[49] || null,
    turnover_rate: +p[38] || null,
    change,
    pct_change: pctChange,
    amplitude: preClose ? (((+p[33] - +p[34]) / preClose) * 100) : 0,
    pe: null,
    pb: null,
    updated_at: new Date().toISOString(),
    source: 'tencent',
  };
}

function parseKline(line) {
  const p = line.split(',');
  return {
    trade_time: p[0],
    open: +p[1],
    close: +p[2],
    high: +p[3],
    low: +p[4],
    volume: +p[5],
    amount: +p[6],
    amplitude: +p[7],
    pct_change: +p[8],
    change: +p[9],
    turnover_rate: +p[10],
  };
}

async function getEastmoneyQuote(secid) {
  const fields =
    "f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f84,f85,f168,f169,f170,f171,f292";
  const url = `${BASE_QUOTE}?secid=${secid}&invt=2&fltt=2&fields=${fields}&ut=fa5fd1943c7b386f172d6893dbfba107&_=${Date.now()}`;
  const json = await fetchJson(url);
  const d = json.data;
  if (!d) return null;
  // invt=2&fltt=2：价格、涨跌幅、量比、换手率为小数，勿再 /100
  const intMode = typeof d.f43 === "number" && d.f43 > 1000;
  const priceScale = intMode ? 100 : 1;
  const pctScale = intMode ? 100 : 1;
  return {
    code: d.f57,
    name: d.f58,
    price: d.f43 / priceScale,
    open: d.f46 / priceScale,
    high: d.f44 / priceScale,
    low: d.f45 / priceScale,
    pre_close: d.f60 / priceScale,
    volume: d.f47,
    amount: d.f48,
    volume_ratio: d.f50 / pctScale,
    turnover_rate: d.f168 / pctScale,
    change: d.f169 / priceScale,
    pct_change: d.f170 / pctScale,
    amplitude: d.f171 / pctScale,
    pe: d.f84 && d.f84 < 1e6 ? d.f84 / 100 : null,
    pb: d.f85 && d.f85 < 1e6 ? d.f85 / 100 : null,
    updated_at: new Date().toISOString(),
    source: "eastmoney",
  };
}

async function getRealtimeQuote(secid, code = "600759", market = "SH") {
  try {
    const em = await getEastmoneyQuote(secid);
    if (em && em.code) return em;
  } catch (e) {
    /* fallback */
  }
  for (const fn of [
    () => getSinaQuote(code, market),
    () => getTencentQuote(code, market),
  ]) {
    try {
      const q = await fn();
      if (q) return q;
    } catch (e) {
      /* next */
    }
  }
  throw new Error("所有行情源均不可用，请检查网络");
}

function marketPrefix(code, market) {
  if (market === 'SH' || code.startsWith('6')) return 'sh';
  return 'sz';
}

/** 腾讯 K 线（day / m1 / m5 等） */
async function getTencentKlines(code, market, period = 'day', limit = 120) {
  const prefix = marketPrefix(code, market);
  const symbol = `${prefix}${code}`;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},${period},,,${limit},qfq&_=${Date.now()}`;
  const json = await fetchJson(url, 20000);
  const key = period === 'day' ? 'qfqday' : `qfq${period}`;
  const rows = json.data?.[symbol]?.[key] || json.data?.[symbol]?.day || [];
  return rows.map((r) => {
    const preClose = r.length > 6 ? +r[6] : null;
    const open = +r[1];
    const close = +r[2];
    const high = +r[3];
    const low = +r[4];
    const volume = +r[5] * 100;
    const change = close - (preClose || open);
    const pct = preClose ? (change / preClose) * 100 : 0;
    const amplitude = open ? ((high - low) / open) * 100 : 0;
    const tradeTime =
      period === 'day' ? r[0] : `${r[0].slice(0, 10)} ${r[0].slice(11) || r[0]}`;
    return {
      trade_time: tradeTime,
      open,
      close,
      high,
      low,
      volume,
      amount: 0,
      amplitude,
      pct_change: pct,
      change,
      turnover_rate: 0,
    };
  });
}

/** 新浪 K 线 scale: 240=日 1/5/15/60=分钟 */
async function getSinaKlines(code, market, scale = 240, datalen = 120) {
  const prefix = marketPrefix(code, market);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${prefix}${code}&scale=${scale}&ma=no&datalen=${datalen}`;
  const rows = await fetchJson(url, 20000);
  if (!Array.isArray(rows)) return [];

  return rows.map((r) => {
    const open = +r.open;
    const close = +r.close;
    const high = +r.high;
    const low = +r.low;
    const volume = +r.volume;
    const change = close - open;
    const pct = open ? (change / open) * 100 : 0;
    return {
      trade_time: r.day,
      open,
      close,
      high,
      low,
      volume,
      amount: 0,
      amplitude: open ? ((high - low) / open) * 100 : 0,
      pct_change: pct,
      change,
      turnover_rate: 0,
    };
  });
}

/** K 线: klt=1 分钟, 101 日 */
async function getKlines(secid, klt = 101, lmt = 120, code = '600759', market = 'SH') {
  const isDaily = klt === 101 || klt === '101';

  if (isDaily) {
    for (const fn of [
      () => getSinaKlines(code, market, 240, lmt),
      () => getTencentKlines(code, market, 'day', lmt),
    ]) {
      try {
        const rows = await fn();
        if (rows.length) return rows;
      } catch {
        /* next */
      }
    }
  } else {
    for (const fn of [
      () => getSinaKlines(code, market, 1, lmt),
      () => getTencentKlines(code, market, 'm1', lmt),
    ]) {
      try {
        const rows = await fn();
        if (rows.length) return rows;
      } catch {
        /* next */
      }
    }
  }

  const params = new URLSearchParams({
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    ut: 'fa5fd1943c7b386f172d6893dbfba107',
    klt: String(klt),
    fqt: '1',
    secid,
    lmt: String(lmt),
    end: '20500101',
    _: String(Date.now()),
  });
  const url = `${BASE_KLINE}?${params}`;
  const json = await fetchJson(url);
  const lines = json.data?.klines || [];
  return lines.map(parseKline);
}

/** 当日分钟资金流（主力净流入等） */
async function getCapitalFlow(secid) {
  const params = new URLSearchParams({
    lmt: '0',
    klt: '1',
    secid,
    fields1: 'f1,f2,f3,f7',
    fields2:
      'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65',
    ut: 'fa5fd1943c7b386f172d6893dbfba107',
    _: String(Date.now()),
  });
  const url = `${BASE_FLOW}?${params}`;
  const json = await fetchJson(url);
  const lines = json.data?.klines || [];
  if (!lines.length) return null;

  const last = lines[lines.length - 1].split(',');
  return {
    trade_time: last[0],
    main_net_inflow: +last[1],
    small_net_inflow: +last[2],
    medium_net_inflow: +last[3],
    large_net_inflow: +last[4],
    super_large_net_inflow: +last[5],
  };
}

function isTradingTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const hour = +parts.find((p) => p.type === 'hour')?.value;
  const minute = +parts.find((p) => p.type === 'minute')?.value;
  const t = hour * 60 + minute;

  const morning = t >= 9 * 60 + 30 && t <= 11 * 60 + 30;
  const afternoon = t >= 13 * 60 && t <= 15 * 60;
  return morning || afternoon;
}

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
  }).format(new Date());
}

module.exports = {
  getRealtimeQuote,
  getKlines,
  getCapitalFlow,
  getSinaQuote,
  getTencentQuote,
  isTradingTime,
  todayStr,
  parseKline,
};
