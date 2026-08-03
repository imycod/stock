/**
 * 主板小盘股筛选导出
 * 数据源：东方财富公开接口（行情/股东/财报/业务）+ 新浪/腾讯日 K（量价）
 * 用法：npm run export:small
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const iconv = require('iconv-lite');
const config = require('../config');

const YI = 1e8;

const DEFAULTS = {
  maxTotalShares: 3 * YI,
  maxMarketCap: 90 * YI,
  maxHolders: 100000,
  minTop10Ratio: 40,
  volumeExpandRatio: 1.5,
  turnoverJumpFrom: 1,
  turnoverJumpTo: 3,
  maxPriceVsYearAvg: 1.0,
  maxPriceVsYearLow: 1.25,
  concurrency: 6,
  outDir: path.join(__dirname, '..', 'data', 'exports'),
};

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://quote.eastmoney.com/',
};

const CLIST_HOSTS = [
  'https://push2delay.eastmoney.com',
  'https://push2.eastmoney.com',
  'https://82.push2.eastmoney.com',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtYi(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '';
  return +(v / YI).toFixed(digits);
}

function pct(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '';
  return +v.toFixed(digits);
}

function isStName(name) {
  const n = String(name || '');
  return /\*ST/.test(n) || /^ST/.test(n) || /ST[\u4e00-\u9fa5]/.test(n);
}

function stTypeOf(name) {
  const n = String(name || '');
  if (/\*ST/.test(n)) return '退市风险警示(*ST)';
  if (/ST/.test(n)) return '其他风险警示(ST)';
  return '';
}

function isMainBoardCode(code) {
  const c = String(code || '');
  // 沪：600/601/603/605；深主板：000/001/002/003
  return /^(600|601|603|605|000|001|002|003)\d{3}$/.test(c);
}

function marketPrefix(code) {
  return String(code).startsWith('6') ? 'sh' : 'sz';
}

async function fetchJson(url, headers = HEADERS, timeoutMs = 20000, retries = 3) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () => run())
  );
  return results;
}

function resolveOptions() {
  const cfg = config.exportSmall || {};
  const opts = { ...DEFAULTS, ...cfg };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--max-shares' && next) {
      opts.maxTotalShares = +next * YI;
      i++;
    } else if (a === '--max-mv' && next) {
      opts.maxMarketCap = +next * YI;
      i++;
    } else if (a === '--max-holders' && next) {
      opts.maxHolders = +next;
      i++;
    } else if (a === '--min-top10' && next) {
      opts.minTop10Ratio = +next;
      i++;
    } else if (a === '--out' && next) {
      opts.outDir = path.resolve(next);
      i++;
    } else if (a === '--loose') {
      opts.volumeExpandRatio = 1.2;
      opts.maxPriceVsYearAvg = 1.1;
      opts.maxPriceVsYearLow = 1.4;
      opts.minTop10Ratio = 0;
    }
  }
  return opts;
}

async function fetchMainBoardList(includeST = false) {
  const fields =
    'f12,f14,f2,f3,f8,f10,f15,f16,f17,f18,f20,f21,f38,f39,f100';
  const fsFilter = 'm:1+t:2,m:0+t:6';
  let page = 1;
  const pageSize = 100;
  let total = null;
  const rows = [];

  while (true) {
    let json = null;
    let lastErr;
    for (const host of CLIST_HOSTS) {
      try {
        const url =
          `${host}/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=1&np=1` +
          `&fltt=2&invt=2&fid=f20&fs=${fsFilter}&fields=${fields}` +
          `&ut=fa5fd1943c7b386f172d6893dbfba107&_=${Date.now()}`;
        json = await fetchJson(url, HEADERS, 20000, 2);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!json) throw lastErr || new Error('clist 拉取失败');

    if (total == null) total = json.data?.total || 0;
    const diff = json.data?.diff || [];
    if (!diff.length) break;

    for (const x of diff) {
      const code = String(x.f12 || '');
      const name = String(x.f14 || '');
      if (!isMainBoardCode(code)) continue;
      if (!includeST && isStName(name)) continue;
      rows.push({
        code,
        name,
        price: num(x.f2),
        pctChange: num(x.f3),
        turnoverRate: num(x.f8),
        volumeRatio: num(x.f10),
        high: num(x.f15),
        low: num(x.f16),
        open: num(x.f17),
        preClose: num(x.f18),
        marketCap: num(x.f20),
        floatCap: num(x.f21),
        totalShares: num(x.f38),
        floatShares: num(x.f39),
        industry: x.f100 || '',
      });
    }

    process.stdout.write(
      `\r[1/4] 主板行情 ${Math.min(page * pageSize, total)}/${total}`
    );
    if (page * pageSize >= total) break;
    page++;
    await sleep(120);
  }
  process.stdout.write('\n');
  return rows;
}

async function fetchHolderInfo(code) {
  const headers = { ...HEADERS, Referer: 'https://data.eastmoney.com/' };
  const filter = encodeURIComponent(`(SECURITY_CODE="${code}")(IS_DEFAULT="1")`);
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get?' +
    'reportName=RPT_F10_EH_HOLDERNUM' +
    '&columns=SECURITY_CODE,SECURITY_NAME_ABBR,END_DATE,HOLDER_TOTAL_NUM,' +
    'HOLD_RATIO_TOTAL,HOLD_FOCUS,AVG_TOTAL_SHARES,NOTICE_DATE,HOLDER_TOTAL_NUMCHANGE,TOTAL_NUM_RATIO' +
    `&filter=${filter}&pageNumber=1&pageSize=1&sortColumns=END_DATE&sortTypes=-1` +
    '&source=WEB&client=WEB';
  const json = await fetchJson(url, headers, 15000, 2);
  const row = json.result?.data?.[0];
  if (!row) return null;
  return {
    holderNum: num(row.HOLDER_TOTAL_NUM),
    holderChange: num(row.HOLDER_TOTAL_NUMCHANGE),
    holderChangeRatio: num(row.TOTAL_NUM_RATIO),
    top10Ratio: num(row.HOLD_RATIO_TOTAL),
    holdFocus: row.HOLD_FOCUS || '',
    holderDate: String(row.END_DATE || '').slice(0, 10),
    avgHoldShares: num(row.AVG_TOTAL_SHARES),
  };
}

async function fetchDailyKlines(code, limit = 260) {
  const prefix = marketPrefix(code);
  try {
    const url =
      'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/' +
      `CN_MarketData.getKLineData?symbol=${prefix}${code}&scale=240&ma=no&datalen=${limit}`;
    const rows = await fetchJson(
      url,
      { ...HEADERS, Referer: 'https://finance.sina.com.cn/' },
      20000,
      2
    );
    if (Array.isArray(rows) && rows.length) {
      return rows.map((r) => ({
        date: r.day,
        open: +r.open,
        high: +r.high,
        low: +r.low,
        close: +r.close,
        volume: +r.volume,
      }));
    }
  } catch {
    /* fallback */
  }

  try {
    const url =
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${prefix}${code},day,,,${limit},qfq&_=${Date.now()}`;
    const json = await fetchJson(
      url,
      { ...HEADERS, Referer: 'https://gu.qq.com/' },
      20000,
      2
    );
    const key = `${prefix}${code}`;
    const rows = json.data?.[key]?.qfqday || json.data?.[key]?.day || [];
    return rows.map((r) => ({
      date: r[0],
      open: +r[1],
      close: +r[2],
      high: +r[3],
      low: +r[4],
      volume: +r[5] * 100,
    }));
  } catch {
    return [];
  }
}

function analyzeVolumePrice(klines, opts, quote) {
  if (!klines?.length) return null;
  const n = klines.length;
  const recent5 = klines.slice(-5);
  const prev5 = klines.slice(-10, -5);
  const recent10 = klines.slice(-10);
  const prev10 = klines.slice(-20, -10);

  const avg = (arr, key) =>
    arr.length ? arr.reduce((s, x) => s + (x[key] || 0), 0) / arr.length : null;

  const vol5 = avg(recent5, 'volume');
  const volPrev5 = avg(prev5, 'volume');
  const vol10 = avg(recent10, 'volume');
  const volPrev10 = avg(prev10, 'volume');

  const volExpand5 = vol5 && volPrev5 ? vol5 / volPrev5 : null;
  const volExpand10 = vol10 && volPrev10 ? vol10 / volPrev10 : null;

  const turnoverNow = quote.turnoverRate;
  const price = quote.price ?? klines[n - 1].close;

  const yearBars = klines.slice(-250);
  const lows = yearBars.map((k) => k.low).filter((x) => x > 0);
  const highs = yearBars.map((k) => k.high).filter((x) => x > 0);
  if (!lows.length || !highs.length) return null;
  const yearLow = Math.min(...lows);
  const yearHigh = Math.max(...highs);
  const yearAvg =
    yearBars.reduce((s, k) => s + k.close, 0) / Math.max(yearBars.length, 1);

  const vsYearAvg = price && yearAvg ? price / yearAvg : null;
  const vsYearLow = price && yearLow ? price / yearLow : null;
  const posInYear =
    yearHigh > yearLow ? (price - yearLow) / (yearHigh - yearLow) : null;

  const volumeOk =
    (volExpand5 != null && volExpand5 >= opts.volumeExpandRatio) ||
    (volExpand10 != null && volExpand10 >= opts.volumeExpandRatio) ||
    (turnoverNow != null &&
      turnoverNow >= opts.turnoverJumpTo &&
      (quote.volumeRatio == null || quote.volumeRatio >= 1.2));

  const priceOk =
    (vsYearAvg != null && vsYearAvg <= opts.maxPriceVsYearAvg) ||
    (vsYearLow != null && vsYearLow <= opts.maxPriceVsYearLow) ||
    (posInYear != null && posInYear <= 0.35);

  const reasons = [];
  if (volExpand5 != null && volExpand5 >= opts.volumeExpandRatio) {
    reasons.push(`5日量能放大${volExpand5.toFixed(2)}倍`);
  }
  if (volExpand10 != null && volExpand10 >= opts.volumeExpandRatio) {
    reasons.push(`10日量能放大${volExpand10.toFixed(2)}倍`);
  }
  if (turnoverNow != null && turnoverNow >= opts.turnoverJumpTo) {
    reasons.push(`换手${turnoverNow.toFixed(2)}%`);
  }
  if (vsYearAvg != null && vsYearAvg <= opts.maxPriceVsYearAvg) {
    reasons.push('低于/贴近年内均价');
  }
  if (vsYearLow != null && vsYearLow <= opts.maxPriceVsYearLow) {
    reasons.push('接近年内低点');
  }
  if (posInYear != null && posInYear <= 0.35) {
    reasons.push(`年内分位${(posInYear * 100).toFixed(0)}%`);
  }

  return {
    vol5,
    volPrev5,
    vol10,
    volPrev10,
    volExpand5,
    volExpand10,
    yearLow,
    yearHigh,
    yearAvg,
    vsYearAvg,
    vsYearLow,
    posInYear,
    volumeOk,
    priceOk,
    pass: volumeOk && priceOk,
    reasons: reasons.join('；'),
  };
}


function secuCode(code) {
  return String(code).startsWith('6') ? `${code}.SH` : `${code}.SZ`;
}

function marketCodePrefix(code) {
  return String(code).startsWith('6') ? 'SH' : 'SZ';
}

function fmtAmount(v) {
  if (v == null || !Number.isFinite(v)) return '';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿元`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)}万元`;
  return `${sign}${abs.toFixed(2)}元`;
}

/** 近两年归母净利阶段：亏损 / 扭亏 / 盈利 / 转亏 / 减亏 */
function classifyProfitStage(latestProfit, prevProfit) {
  if (latestProfit == null) return '数据不足';
  if (prevProfit == null) return latestProfit > 0 ? '盈利阶段' : '亏损阶段';
  if (prevProfit < 0 && latestProfit > 0) return '扭亏阶段';
  if (prevProfit > 0 && latestProfit < 0) return '转亏阶段';
  if (latestProfit < 0 && prevProfit < 0) {
    return latestProfit > prevProfit ? '减亏阶段' : '亏损阶段';
  }
  if (latestProfit > 0 && prevProfit > 0) return '盈利阶段';
  if (latestProfit === 0) return latestProfit >= prevProfit ? '盈亏平衡' : '转亏阶段';
  return '数据不足';
}

function extractPartners(text, selfName = '') {
  if (!text) return '';
  const junk =
    /奠定|合作关系|长期稳定|良好合作|主要客户|客户资源|国内外知名|跨国企业|行业内|大型知名|持续服务|互利合作|共同成长|公司定位|系统解决方案|龙头企业/;
  const m =
    text.match(/与([^。；]{6,240}?)(?:等国内外知名|等国内外|等知名公司|等建立|建立了稳定|建立合作)/) ||
    text.match(/客户包括[:：]?([^。；]{4,200})/) ||
    text.match(/(?:合作伙伴|合作客户)[:：]?([^。；]{4,200})/);

  const lookLikeOrg = (s) => {
    if (!s || s.length < 2 || s.length > 40) return false;
    if (selfName && (s.includes(selfName) || selfName.includes(s))) return false;
    if (junk.test(s)) return false;
    if (/集团|股份|科技|公司|有限|企业|控股/.test(s)) return true;
    if (/^[A-Za-z][A-Za-z0-9&.\-\s]{1,30}$/.test(s)) return true;
    if (/^[\u4e00-\u9fa5A-Za-z0-9]{2,12}$/.test(s) && !/公司|企业|行业|市场|产品/.test(s)) {
      return true;
    }
    return false;
  };

  if (m) {
    const parts = m[1]
      .split(/[、，,]/)
      .map((s) => s.replace(/^(?:包括|如|有)/, '').trim())
      .filter(lookLikeOrg);
    // 至少 2 个像名单；单个且含噪声则丢弃
    if (parts.length >= 2 || (parts.length === 1 && parts[0].length <= 20 && !/的/.test(parts[0]))) {
      return [...new Set(parts)].slice(0, 15).join('、');
    }
  }

  const names = text.match(
    /[A-Za-z\u4e00-\u9fa5]{2,20}(?:集团|股份|科技|有限公司)/g
  );
  if (!names) return '';
  return [...new Set(names.filter((n) => lookLikeOrg(n)))].slice(0, 12).join('、');
}

async function fetchAnnualFinance(code) {
  const secu = secuCode(code);
  const filter = encodeURIComponent(`(SECUCODE="${secu}")(REPORT_TYPE="年报")`);
  const url =
    'https://datacenter.eastmoney.com/securities/api/data/v1/get?' +
    'reportName=RPT_F10_FINANCE_MAINFINADATA' +
    '&columns=SECUCODE,SECURITY_CODE,REPORT_DATE,REPORT_TYPE,REPORT_DATE_NAME,' +
    'TOTALOPERATEREVE,PARENTNETPROFIT,TOTALOPERATEREVETZ,PARENTNETPROFITTZ,KCFJCXSYJLR' +
    `&filter=${filter}&pageNumber=1&pageSize=4&sortTypes=-1&sortColumns=REPORT_DATE` +
    '&source=HSF10&client=PC';
  const json = await fetchJson(
    url,
    { ...HEADERS, Referer: 'https://emweb.securities.eastmoney.com/' },
    15000,
    2
  );
  const rows = json.result?.data || [];
  const latest = rows[0] || null;
  const prev = rows[1] || null;
  const revenue1 = num(latest?.TOTALOPERATEREVE);
  const revenue0 = num(prev?.TOTALOPERATEREVE);
  const profit1 = num(latest?.PARENTNETPROFIT);
  const profit0 = num(prev?.PARENTNETPROFIT);
  const revenueYoy = num(latest?.TOTALOPERATEREVETZ);
  const profitYoy = num(latest?.PARENTNETPROFITTZ);
  const stage = classifyProfitStage(profit1, profit0);
  const year1 = latest ? String(latest.REPORT_DATE).slice(0, 4) : '';
  const year0 = prev ? String(prev.REPORT_DATE).slice(0, 4) : '';

  let financeSummary = '';
  if (latest) {
    financeSummary =
      `${year1}年营业收入${fmtAmount(revenue1)}` +
      (revenueYoy != null ? `，同比增长${pct(revenueYoy)}%` : '') +
      `；归母净利润${fmtAmount(profit1)}` +
      (profit0 != null ? `，上年为${fmtAmount(profit0)}` : '') +
      (profitYoy != null ? `（同比${pct(profitYoy)}%）` : '');
  }

  return {
    financeYear1: year1,
    financeYear0: year0,
    revenue1,
    revenue0,
    revenueYoy,
    profit1,
    profit0,
    profitYoy,
    profitStage: stage,
    financeSummary,
  };
}

async function fetchCompanyBusiness(code, selfName = '') {
  const prefix = marketCodePrefix(code);
  const headers = {
    ...HEADERS,
    Referer: 'https://emweb.securities.eastmoney.com/',
  };

  let profile = '';
  let businessScope = '';
  let products = '';
  let partners = '';
  let businessReview = '';

  try {
    const company = await fetchJson(
      `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${prefix}${code}`,
      headers,
      15000,
      2
    );
    const jb = company.jbzl?.[0] || {};
    profile = String(jb.ORG_PROFILE || '').replace(/\s+/g, ' ').trim();
    businessScope = String(jb.BUSINESS_SCOPE || '').replace(/\s+/g, ' ').trim();
  } catch {
    /* optional */
  }

  try {
    const biz = await fetchJson(
      `https://emweb.securities.eastmoney.com/PC_HSF10/BusinessAnalysis/PageAjax?code=${prefix}${code}`,
      headers,
      15000,
      2
    );
    businessReview = String(biz.jyps?.[0]?.BUSINESS_REVIEW || '')
      .replace(/\s+/g, ' ')
      .trim();
    const comps = biz.zygcfx || [];
    const latestDate = comps[0]?.REPORT_DATE;
    const productRows = comps
      .filter(
        (x) =>
          String(x.MAINOP_TYPE) === '2' &&
          x.REPORT_DATE === latestDate &&
          x.ITEM_NAME &&
          !String(x.ITEM_NAME).startsWith('其中')
      )
      .sort((a, b) => (b.MBI_RATIO || 0) - (a.MBI_RATIO || 0))
      .slice(0, 5);
    products = productRows
      .map((x) => {
        const ratio =
          x.MBI_RATIO != null ? `${(x.MBI_RATIO * 100).toFixed(1)}%` : '';
        return `${x.ITEM_NAME}${ratio ? `(${ratio})` : ''}`;
      })
      .join('；');
  } catch {
    /* optional */
  }

  try {
    const op = await fetchJson(
      `https://emweb.securities.eastmoney.com/PC_HSF10/OperationsRequired/PageAjax?code=${prefix}${code}`,
      headers,
      15000,
      2
    );
    const hxtc = op.hxtc || [];
    const cust =
      hxtc.find((x) => /客户资源|主要客户|核心客户|合作伙伴/.test(x.KEYWORD || '')) ||
      hxtc.find((x) => /客户|合作/.test(x.KEYWORD || ''));
    partners = extractPartners(cust?.MAINPOINT_CONTENT || '', selfName);
    if (!partners) {
      partners = extractPartners(profile, selfName);
    }
  } catch {
    /* optional */
  }

  const businessBrief = (profile || businessReview || businessScope || '').slice(
    0,
    180
  );

  return {
    businessBrief,
    mainProducts: products,
    partners,
    businessScope: businessScope.slice(0, 120),
  };
}


async function fetchStInfo(code, name) {
  if (!isStName(name)) {
    return {
      isST: false,
      stType: '',
      stDate: '',
      stReason: '',
      stRemoveEstimate: '',
      stAnnTitle: '',
    };
  }

  const stType = stTypeOf(name);
  let stDate = '';
  let stReason = '';
  let stRemoveEstimate = '';
  let stAnnTitle = '';

  try {
    const anns = [];
    for (let page = 1; page <= 8; page++) {
      const url =
        'https://np-anotice-stock.eastmoney.com/api/security/ann?' +
        `sr=-1&page_size=50&page_index=${page}&ann_type=A&stock_list=${code}&f_node=0&s_node=0`;
      const json = await fetchJson(
        url,
        { ...HEADERS, Referer: 'https://data.eastmoney.com/' },
        15000,
        1
      );
      const list = json.data?.list || [];
      if (!list.length) break;
      for (const a of list) anns.push(a);
      if (anns.length >= 200) break;
    }

    const isImpl = (t) =>
      /实施.*(风险警示|ST)|被实施.*(风险警示|ST)|实行.*风险警示/.test(t) &&
      !/进展|申请撤销|关于撤销/.test(t);
    const isRemove = (t) => /撤销.*(风险警示|ST)|摘帽|申请撤销/.test(t);
    const impl = anns.find((a) => isImpl(a.title || ''));
    const removeApp = anns.find((a) => isRemove(a.title || ''));

    if (impl) {
      stAnnTitle = String(impl.title || '').replace(/^[^:：]*[:：]/, '');
      stDate = String(impl.notice_date || '').slice(0, 10);
      try {
        const detail = await fetchJson(
          `https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=${impl.art_code}&client_source=web`,
          { ...HEADERS, Referer: 'https://data.eastmoney.com/notices/' },
          15000,
          1
        );
        const content = String(detail.data?.notice_content || '').replace(/\s+/g, ' ');
        const mDate =
          content.match(/实施起始日[为是]?\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/) ||
          content.match(/实施风险警示的起始日[:：]?\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/);
        if (mDate) {
          stDate = mDate[1].replace(/\s+/g, '').replace(/年|月/g, '-').replace(/日/, '');
          // normalize 2026-4-29 -> 2026-04-29
          const p = stDate.split('-');
          if (p.length === 3) {
            stDate = `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
          }
        }
        const mReason =
          content.match(/因([^。]{10,120}?)(?:根据|将被实施|公司股票将被实施)/) ||
          content.match(/适用情形[\s\S]{0,40}?([\u4e00-\u9fa5A-Za-z0-9，,]{20,160}?)(?:根据|。)/);
        if (mReason) stReason = mReason[1].replace(/\s+/g, '').slice(0, 120);
        if (!stReason) {
          const tip = content.match(/重要内容提示[：:]([\s\S]{20,200}?)(?:本公司的相关证券|第一节)/);
          if (tip) stReason = tip[1].replace(/\s+/g, '').slice(0, 120);
        }
      } catch {
        /* ignore */
      }
    }

    if (!stReason && stAnnTitle) stReason = stAnnTitle.slice(0, 80);

    if (removeApp && /申请撤销/.test(removeApp.title || '')) {
      stRemoveEstimate =
        '已申请撤销（公告日 ' + String(removeApp.notice_date || '').slice(0, 10) + '）';
    } else if (/内部控制|否定意见|审计/.test(stReason)) {
      stRemoveEstimate = '整改完成且内控审计意见恢复后，关注年报披露后申请摘帽';
    } else if (/净利润|亏损|财务/.test(stReason)) {
      stRemoveEstimate = '扭亏并满足上市规则后，通常于下一年度报告披露后可申请摘帽';
    } else if (stType.includes('*ST')) {
      stRemoveEstimate = '消除退市风险情形后可申请撤销*ST，关注年报/进展公告';
    } else if (stType) {
      stRemoveEstimate = '相关情形消除后可申请撤销ST，关注进展公告';
    }
  } catch {
    /* optional */
  }

  return {
    isST: true,
    stType,
    stDate,
    stReason,
    stRemoveEstimate,
    stAnnTitle,
  };
}


async function fetchMarketWeather() {
  const headers = { ...HEADERS, Referer: 'https://quote.eastmoney.com/' };
  let quote = null;
  for (const host of CLIST_HOSTS) {
    try {
      const url =
        `${host}/api/qt/stock/get?secid=1.000001&invt=2&fltt=2` +
        '&fields=f43,f47,f48,f57,f58,f60,f169,f170,f168,f50' +
        '&ut=fa5fd1943c7b386f172d6893dbfba107&_=' +
        Date.now();
      const json = await fetchJson(url, headers, 12000, 2);
      if (json.data) {
        quote = json.data;
        break;
      }
    } catch {
      /* next */
    }
  }

  let klines = [];
  try {
    klines = await fetchJson(
      'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sh000001&scale=240&ma=no&datalen=5',
      { ...HEADERS, Referer: 'https://finance.sina.com.cn/' },
      15000,
      2
    );
  } catch {
    klines = [];
  }
  if (!Array.isArray(klines)) klines = [];

  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2];
  const price = num(quote?.f43) ?? num(last?.close);
  const preClose = num(quote?.f60) ?? num(prev?.close);
  const pctChange =
    num(quote?.f170) ??
    (price != null && preClose ? ((price - preClose) / preClose) * 100 : null);
  const volToday = num(quote?.f47) ?? (last ? +last.volume / 100 : null);
  const volPrev = prev ? +prev.volume / 100 : null;
  const volShrink =
    volToday != null && volPrev != null ? volToday < volPrev * 0.98 : false;
  const volExpand =
    volToday != null && volPrev != null ? volToday > volPrev * 1.02 : false;

  let weather = '阴天';
  let weatherLabel = '平淡';
  if (pctChange != null && pctChange > 0.15) {
    weather = '太阳';
    weatherLabel = '大盘上涨';
  } else if (pctChange != null && pctChange < -0.15 && volShrink) {
    weather = '乌云下雨';
    weatherLabel = '绿盘缩量下跌';
  } else if (pctChange != null && pctChange < -0.15) {
    weather = '乌云';
    weatherLabel = '绿盘下跌';
  } else if (volExpand && pctChange != null && pctChange <= 0) {
    weather = '阴有风';
    weatherLabel = '缩涨放量/震荡';
  }

  return {
    indexCode: '000001',
    indexName: quote?.f58 || '上证指数',
    indexPrice: price,
    indexPctChange: pctChange != null ? +pctChange.toFixed(2) : null,
    indexVolume: volToday,
    indexVolShrink: volShrink,
    weather,
    weatherLabel,
    tradeDate: last?.day || '',
  };
}

function daysBetween(dateStr) {
  if (!dateStr) return null;
  const t = Date.parse(String(dateStr).slice(0, 10));
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

async function fetchAnnouncementList(code, maxPages = 5) {
  const anns = [];
  for (let page = 1; page <= maxPages; page++) {
    const url =
      'https://np-anotice-stock.eastmoney.com/api/security/ann?' +
      `sr=-1&page_size=50&page_index=${page}&ann_type=A&stock_list=${code}&f_node=0&s_node=0`;
    try {
      const json = await fetchJson(
        url,
        { ...HEADERS, Referer: 'https://data.eastmoney.com/' },
        15000,
        1
      );
      const list = json.data?.list || [];
      if (!list.length) break;
      for (const a of list) anns.push(a);
    } catch {
      break;
    }
  }
  return anns;
}

async function fetchAnnExtras(code, name) {
  const anns = await fetchAnnouncementList(code, isStName(name) ? 10 : 8);
  const titleOf = (a) => String(a.title || '');
  const dateOf = (a) => String(a.notice_date || '').slice(0, 10);

  const isImpl = (t) =>
    /实施.*(风险警示|ST)|被实施.*(风险警示|ST)|实行.*风险警示/.test(t) &&
    !/进展|申请撤销|关于撤销/.test(t);
  const isUncap = (t) =>
    /撤销.*(风险警示|ST|警示)|摘帽|撤销退市风险/.test(t) &&
    !/申请撤销|相关事项的进展|整改进展/.test(t);
  const isAbnormal = (t) => /异动|异常波动|严重异常波动/.test(t);
  const isInvest = (t) =>
    /对外投资|投资设立|设立子公司|增资.*子公司|控股子公司|参股/.test(t);

  const impl = anns.find((a) => isImpl(titleOf(a)));
  const uncap = anns.find((a) => isUncap(titleOf(a)));
  const removeApp = anns.find((a) => /申请撤销.*(风险警示|ST)/.test(titleOf(a)));
  const abnormals = anns.filter((a) => isAbnormal(titleOf(a)));
  const investAnns = anns.filter((a) => isInvest(titleOf(a))).slice(0, 5);

  let stDate = impl ? dateOf(impl) : '';
  let stReason = '';
  let stAnnTitle = impl ? titleOf(impl).replace(/^[^:：]*[:：]/, '') : '';
  let stRemoveEstimate = '';

  if (impl?.art_code) {
    try {
      const detail = await fetchJson(
        `https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=${impl.art_code}&client_source=web`,
        { ...HEADERS, Referer: 'https://data.eastmoney.com/notices/' },
        12000,
        1
      );
      const content = String(detail.data?.notice_content || '').replace(/\s+/g, ' ');
      const mDate =
        content.match(/实施起始日[为是]?\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/) ||
        content.match(/实施风险警示的起始日[:：]?\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/);
      if (mDate) {
        const p = mDate[1]
          .replace(/\s+/g, '')
          .replace(/年|月/g, '-')
          .replace(/日/, '')
          .split('-');
        if (p.length === 3) {
          stDate = `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
        }
      }
      const mReason =
        content.match(/因([^。]{10,120}?)(?:根据|将被实施|公司股票将被实施)/) ||
        content.match(/适用情形[\s\S]{0,40}?([\u4e00-\u9fa5A-Za-z0-9，,]{20,160}?)(?:根据|。)/);
      if (mReason) stReason = mReason[1].replace(/\s+/g, '').slice(0, 120);
    } catch {
      /* ignore */
    }
  }
  if (!stReason && stAnnTitle) stReason = stAnnTitle.slice(0, 80);

  const uncapDate = uncap ? dateOf(uncap) : '';
  const uncapDays = daysBetween(uncapDate);
  const justUncapped = !!(uncapDate && uncapDays != null && uncapDays <= 730 && !isStName(name));

  if (isStName(name)) {
    if (removeApp && /申请撤销/.test(titleOf(removeApp))) {
      stRemoveEstimate =
        '已申请撤销（公告日 ' + dateOf(removeApp) + '）';
    } else if (/内部控制|否定意见|审计/.test(stReason)) {
      stRemoveEstimate = '整改完成且内控审计意见恢复后，关注年报披露后申请摘帽';
    } else if (/净利润|亏损|财务/.test(stReason)) {
      stRemoveEstimate = '扭亏并满足上市规则后，通常于下一年度报告披露后可申请摘帽';
    } else if (stTypeOf(name).includes('*ST')) {
      stRemoveEstimate = '消除退市风险情形后可申请撤销*ST，关注年报/进展公告';
    } else {
      stRemoveEstimate = '相关情形消除后可申请撤销ST，关注进展公告';
    }
  }

  const lastAbn = abnormals[0];
  const investFromAnn = investAnns
    .map((a) => dateOf(a) + ' ' + titleOf(a).replace(/^[^:：]*[:：]/, ''))
    .join('；');

  return {
    isST: isStName(name),
    stType: stTypeOf(name),
    stDate,
    stReason,
    stRemoveEstimate,
    stAnnTitle,
    justUncapped,
    uncapDate,
    uncapTitle: uncap ? titleOf(uncap).replace(/^[^:：]*[:：]/, '') : '',
    hasAbnormal: abnormals.length > 0,
    abnormalCount: abnormals.length,
    lastAbnormalDate: lastAbn ? dateOf(lastAbn) : '',
    abnormalSummary: abnormals
      .slice(0, 3)
      .map((a) => dateOf(a) + ' ' + titleOf(a).replace(/^[^:：]*[:：]/, ''))
      .join('；'),
    investFromAnn,
  };
}

async function fetchInvestAndStaff(code, selfName = '') {
  const prefix = marketCodePrefix(code);
  const headers = {
    ...HEADERS,
    Referer: 'https://emweb.securities.eastmoney.com/',
  };
  let employeeNum = null;
  let province = '';
  let investInfo = '';
  const parts = [];

  try {
    const company = await fetchJson(
      `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${prefix}${code}`,
      headers,
      15000,
      2
    );
    const jb = company.jbzl?.[0] || {};
    employeeNum = num(jb.EMP_NUM) ?? num(jb.TATOLNUMBER);
    province = jb.PROVINCE || '';
  } catch {
    /* optional */
  }

  try {
    const news = await fetchJson(
      `https://emweb.securities.eastmoney.com/PC_HSF10/CompanyBigNews/PageAjax?code=${prefix}${code}`,
      headers,
      15000,
      1
    );
    const guars = (news.dwdb || [])
      .map((x) => x.GUARANTEED_NAME)
      .filter(Boolean);
    const uniq = [...new Set(guars)].slice(0, 8);
    if (uniq.length) parts.push('担保/关联方: ' + uniq.join('、'));
  } catch {
    /* optional */
  }

  try {
    const op = await fetchJson(
      `https://emweb.securities.eastmoney.com/PC_HSF10/OperationsRequired/PageAjax?code=${prefix}${code}`,
      headers,
      15000,
      1
    );
    const hit = (op.hxtc || []).find((x) =>
      /子公司|海外|投资|全球化/.test((x.KEYWORD || '') + (x.MAINPOINT_CONTENT || ''))
    );
    if (hit?.MAINPOINT_CONTENT) {
      const text = String(hit.MAINPOINT_CONTENT);
      const m = text.match(/设立([^。；]{4,80}?)(?:覆盖|等|，|。)/);
      const names =
        text.match(/[\u4e00-\u9fa5A-Za-z]{2,20}(?:子公司|有限公司|公司)/g) || [];
      const cleaned = [...new Set(names)]
        .filter((n) => !selfName || !n.includes(selfName))
        .slice(0, 8);
      if (cleaned.length) parts.push('布局: ' + cleaned.join('、'));
      else if (m) parts.push('布局: ' + m[1]);
    }
  } catch {
    /* optional */
  }

  investInfo = parts.join('；');
  return { employeeNum, province, investInfo };
}

async function enrichFundamentals(row) {
  const [fin, biz, ann, staffInv] = await Promise.all([
    fetchAnnualFinance(row.code).catch(() => ({})),
    fetchCompanyBusiness(row.code, row.name).catch(() => ({})),
    fetchAnnExtras(row.code, row.name).catch(() => ({ isST: isStName(row.name) })),
    fetchInvestAndStaff(row.code, row.name).catch(() => ({})),
  ]);
  const investMerged = [staffInv.investInfo, ann.investFromAnn]
    .filter(Boolean)
    .join('；');
  return {
    ...row,
    ...fin,
    ...biz,
    ...ann,
    employeeNum: staffInv.employeeNum ?? null,
    province: staffInv.province || '',
    outboundInvest: investMerged,
  };
}

function buildExcelRows(rows) {
  return rows.map((r, i) => ({
    序号: i + 1,
    代码: r.code,
    名称: r.name,
    行业: r.industry || '',
    最新价: r.price ?? '',
    涨跌幅pct: pct(r.pctChange),
    盈利阶段: r.profitStage || '',
    近两年财务摘要: r.financeSummary || '',
    最新年报年份: r.financeYear1 || '',
    营业收入最新: r.revenue1 != null ? fmtAmount(r.revenue1) : '',
    营收同比pct: pct(r.revenueYoy),
    归母净利最新: r.profit1 != null ? fmtAmount(r.profit1) : '',
    归母净利上年: r.profit0 != null ? fmtAmount(r.profit0) : '',
    净利同比pct: pct(r.profitYoy),
    上年报年份: r.financeYear0 || '',
    上年营业收入: r.revenue0 != null ? fmtAmount(r.revenue0) : '',
    主营产品: r.mainProducts || '',
    合作方: r.partners || '',
    业务简介: r.businessBrief || '',
    总股本亿股: fmtYi(r.totalShares),
    总市值亿元: fmtYi(r.marketCap),
    流通市值亿元: fmtYi(r.floatCap),
    股东户数: r.holderNum ?? '',
    户数变动: r.holderChange ?? '',
    户数变动pct: pct(r.holderChangeRatio),
    股东日期: r.holderDate || '',
    前十大持股pct: pct(r.top10Ratio),
    持股集中度: r.holdFocus || '',
    换手率pct: pct(r.turnoverRate),
    量比: pct(r.volumeRatio),
    近5日均量: r.vol5 != null ? Math.round(r.vol5) : '',
    前5日均量: r.volPrev5 != null ? Math.round(r.volPrev5) : '',
    五日量能放大: pct(r.volExpand5),
    近10日均量: r.vol10 != null ? Math.round(r.vol10) : '',
    前10日均量: r.volPrev10 != null ? Math.round(r.volPrev10) : '',
    十日量能放大: pct(r.volExpand10),
    年内最低: pct(r.yearLow),
    年内最高: pct(r.yearHigh),
    年内均价: pct(r.yearAvg),
    现价比年内均价: pct(r.vsYearAvg),
    现价比年内低点: pct(r.vsYearLow),
    年内价格分位pct: r.posInYear != null ? pct(r.posInYear * 100) : '',
    筛选理由: r.reasons || '',
  }));
}

function writeExcel(rows, outPath, meta) {
  const wb = XLSX.utils.book_new();
  const dataRows = buildExcelRows(rows);
  const ws = XLSX.utils.json_to_sheet(dataRows);
  if (dataRows.length) {
    ws['!cols'] = Object.keys(dataRows[0]).map((k) => ({
      wch: Math.min(18, Math.max(10, String(k).length + 2)),
    }));
  }
  XLSX.utils.book_append_sheet(wb, ws, '小盘筛选');

  const metaSheet = XLSX.utils.aoa_to_sheet([
    ['生成时间', meta.generatedAt],
    ['数据源', '东方财富公开接口 + 新浪/腾讯日K'],
    ['板块', '沪深主板（排除ST/*ST、科创、创业、北交）'],
    ['总股本上限(亿股)', meta.opts.maxTotalShares / YI],
    ['总市值上限(亿元)', meta.opts.maxMarketCap / YI],
    ['股东户数上限', meta.opts.maxHolders],
    ['前十大持股下限(%)', meta.opts.minTop10Ratio],
    ['量能放大倍数', meta.opts.volumeExpandRatio],
    ['现价/年内均价上限', meta.opts.maxPriceVsYearAvg],
    ['现价/年内低点上限', meta.opts.maxPriceVsYearLow],
    ['主板原始数量', meta.stats.mainBoard],
    ['股本市值初筛', meta.stats.afterSize],
    ['股东户数筛选', meta.stats.afterHolder],
    ['量价终筛', meta.stats.final],
    ['财务规则', '近两年年报：上年亏今年盈=扭亏；连续盈利=盈利；连续亏损=亏损；今年转负=转亏'],
  ]);
  XLSX.utils.book_append_sheet(wb, metaSheet, '筛选条件');
  XLSX.writeFile(wb, outPath);
}


/**
 * 可编程筛选入口（Web / CLI 共用）
 * @param {object} userOpts
 * @param {(stage:string, payload:object)=>void} onProgress
 */

function secidOf(code) {
  const c = String(code || '');
  // 沪市 1.xxxxxx，深/北交所 0.xxxxxx
  return c.startsWith('6') || c.startsWith('5') ? `1.${c}` : `0.${c}`;
}

async function resolveStockQuery(q) {
  const query = String(q || '').trim();
  if (!query) throw new Error('请输入股票代码或名称');

  const codeHint = /^\d{6}$/.test(query) ? query : null;

  try {
    const url =
      'https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15&key=' +
      encodeURIComponent(query);
    const res = await fetch(url, {
      headers: {
        'User-Agent': HEADERS['User-Agent'],
        Referer: 'https://finance.sina.com.cn/',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`联想接口 HTTP ${res.status}`);
    const text = iconv.decode(Buffer.from(await res.arrayBuffer()), 'gb18030');
    const m = text.match(/suggestvalue="([^"]*)"/);
    const raw = (m && m[1]) || '';
    const items = raw
      .split(';')
      .filter(Boolean)
      .map((line) => {
        const p = line.split(',');
        return {
          hint: p[0] || '',
          type: p[1] || '',
          code: p[2] || '',
          symbol: (p[3] || '').toLowerCase(),
          name: p[4] || p[0] || '',
        };
      })
      .filter((x) => /^\d{6}$/.test(x.code))
      // 排除指数：symbol 形如 sh000001 且名称含「指数」
      .filter((x) => !/指数/.test(x.name) && !/指数/.test(x.hint));

    if (codeHint) {
      const exact = items.find((x) => x.code === codeHint);
      if (exact) return { code: exact.code, name: exact.name || exact.hint };
      return { code: codeHint, name: '' };
    }

    const norm = (str) => String(str || '').replace(/\s+/g, '').toLowerCase();
    const qn = norm(query);
    const byName = items.find(
      (x) => norm(x.name) === qn || norm(x.hint) === qn
    );
    if (byName) return { code: byName.code, name: byName.name || byName.hint };
    const fuzzy = items.find((x) => norm(x.name).includes(qn) || norm(x.hint).includes(qn));
    if (fuzzy) return { code: fuzzy.code, name: fuzzy.name || fuzzy.hint };
    if (items[0]) return { code: items[0].code, name: items[0].name || items[0].hint };
  } catch (e) {
    if (codeHint) return { code: codeHint, name: '' };
    throw e;
  }

  if (codeHint) return { code: codeHint, name: '' };
  throw new Error(`未找到股票: ${query}`);
}

async function fetchQuoteByCode(code) {
  const fields =
    'f12,f14,f2,f3,f8,f10,f15,f16,f17,f18,f20,f21,f38,f39,f100';
  const secid = secidOf(code);
  let lastErr;
  for (const host of CLIST_HOSTS) {
    try {
      const url =
        `${host}/api/qt/ulist.np/get?fltt=2&invt=2&secids=${secid}` +
        `&fields=${fields}&ut=fa5fd1943c7b386f172d6893dbfba107&_=${Date.now()}`;
      const json = await fetchJson(url, HEADERS, 15000, 2);
      const x = json.data?.diff?.[0];
      if (!x) throw new Error('无行情数据');
      return {
        code: String(x.f12 || code),
        name: String(x.f14 || ''),
        price: num(x.f2),
        pctChange: num(x.f3),
        turnoverRate: num(x.f8),
        volumeRatio: num(x.f10),
        high: num(x.f15),
        low: num(x.f16),
        open: num(x.f17),
        preClose: num(x.f18),
        marketCap: num(x.f20),
        floatCap: num(x.f21),
        totalShares: num(x.f38),
        floatShares: num(x.f39),
        industry: x.f100 || '',
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`行情拉取失败: ${code}`);
}

/**
 * 按代码/名称远程查询单只股票完整信息（不走筛选条件过滤）
 */
async function lookupStock(query, userOpts = {}) {
  const cfg = (require('../config').exportSmall) || {};
  const opts = { ...DEFAULTS, ...cfg, ...userOpts };
  const resolved = await resolveStockQuery(query);
  const quote = await fetchQuoteByCode(resolved.code);
  if (!quote.name && resolved.name) quote.name = resolved.name;

  const [holder, klines, market] = await Promise.all([
    fetchHolderInfo(quote.code).catch(() => null),
    fetchDailyKlines(quote.code, 260).catch(() => []),
    fetchMarketWeather().catch(() => null),
  ]);

  const analysis = analyzeVolumePrice(klines || [], opts, quote) || {};
  // 远程查询始终展示，不要求量价条件 pass
  const row = {
    ...quote,
    ...(holder || {}),
    ...analysis,
    reasons: analysis.reasons || '',
  };
  const enriched = await enrichFundamentals(row);
  return { row: enriched, market, resolved };
}

async function runScreen(userOpts = {}, onProgress = () => {}) {
  const cfg = (require('../config').exportSmall) || {};
  const opts = { ...DEFAULTS, ...cfg, ...userOpts };
  const progress = (stage, payload = {}) => {
    try {
      onProgress(stage, payload);
    } catch {
      /* ignore */
    }
  };

  progress('clist', { message: '拉取主板行情' });
  const marketWeather = await fetchMarketWeather().catch(() => null);
  const all = await fetchMainBoardList(!!opts.includeST);
  const sized = all.filter((r) => {
    if (!(r.marketCap > 0 && r.marketCap < opts.maxMarketCap)) return false;
    if (!(r.totalShares > 0 && r.totalShares < opts.maxTotalShares)) return false;
    return true;
  });
  progress('size', { message: '股本市值初筛', total: all.length, matched: sized.length });

  let done = 0;
  const withHolder = [];
  await mapPool(sized, opts.concurrency, async (row) => {
    try {
      const h = await fetchHolderInfo(row.code);
      done++;
      if (done % 20 === 0 || done === sized.length) {
        progress('holder', { done, total: sized.length });
      }
      if (!h || h.holderNum == null) return;
      if (h.holderNum > opts.maxHolders) return;
      if (
        opts.minTop10Ratio > 0 &&
        h.top10Ratio != null &&
        h.top10Ratio < opts.minTop10Ratio
      ) {
        return;
      }
      withHolder.push({ ...row, ...h });
    } catch {
      done++;
    }
  });
  withHolder.sort((a, b) => (a.holderNum || 0) - (b.holderNum || 0));
  progress('holder_done', { matched: withHolder.length });

  const finalRows = [];
  let kDone = 0;
  await mapPool(withHolder, Math.min(4, opts.concurrency), async (row) => {
    try {
      const klines = await fetchDailyKlines(row.code, 260);
      const analysis = analyzeVolumePrice(klines, opts, row);
      kDone++;
      if (kDone % 10 === 0 || kDone === withHolder.length) {
        progress('volume', { done: kDone, total: withHolder.length });
      }
      if (!analysis || !analysis.pass) return;
      finalRows.push({ ...row, ...analysis });
    } catch {
      kDone++;
    }
  });

  finalRows.sort((a, b) => {
    const score = (x) =>
      (x.volExpand5 || 0) * 2 +
      (x.volExpand10 || 0) +
      (x.top10Ratio || 0) / 50 -
      (x.vsYearAvg || 1);
    return score(b) - score(a);
  });

  progress('fundamentals', { message: '财务业务补全', total: finalRows.length });
  const enriched = [];
  let fDone = 0;
  await mapPool(finalRows, Math.min(4, opts.concurrency), async (row) => {
    try {
      enriched.push(await enrichFundamentals(row));
    } catch {
      enriched.push(row);
    } finally {
      fDone++;
      if (fDone % 5 === 0 || fDone === finalRows.length) {
        progress('fundamentals', { done: fDone, total: finalRows.length });
      }
    }
  });
  const order = new Map(finalRows.map((r, i) => [r.code, i]));
  enriched.sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));

  const stageCount = {};
  for (const r of enriched) {
    const s = r.profitStage || '数据不足';
    stageCount[s] = (stageCount[s] || 0) + 1;
  }

  return {
    rows: enriched,
    market: marketWeather,
    stats: {
      mainBoard: all.length,
      afterSize: sized.length,
      afterHolder: withHolder.length,
      final: enriched.length,
      stageCount,
      stCount: enriched.filter((r) => r.isST).length,
    },
    opts: {
      maxTotalShares: opts.maxTotalShares,
      maxMarketCap: opts.maxMarketCap,
      maxHolders: opts.maxHolders,
      minTop10Ratio: opts.minTop10Ratio,
      volumeExpandRatio: opts.volumeExpandRatio,
      maxPriceVsYearAvg: opts.maxPriceVsYearAvg,
      maxPriceVsYearLow: opts.maxPriceVsYearLow,
      includeST: !!opts.includeST,
      turnoverJumpTo: opts.turnoverJumpTo,
    },
    generatedAt: new Date().toISOString(),
  };
}

async function main() {
  const opts = resolveOptions();
  console.log('主板小盘筛选导出');
  console.log(
    `条件: 总股本<${opts.maxTotalShares / YI}亿股, 总市值<${opts.maxMarketCap / YI}亿, 股东<${opts.maxHolders}, 前十大>=${opts.minTop10Ratio}%`
  );

  const all = await fetchMainBoardList(!!opts.includeST);
  const sized = all.filter((r) => {
    if (!(r.marketCap > 0 && r.marketCap < opts.maxMarketCap)) return false;
    if (!(r.totalShares > 0 && r.totalShares < opts.maxTotalShares)) return false;
    return true;
  });
  console.log(`[2/4] 股本/市值初筛 ${sized.length}/${all.length}`);

  let done = 0;
  const withHolder = [];
  await mapPool(sized, opts.concurrency, async (row) => {
    try {
      const h = await fetchHolderInfo(row.code);
      done++;
      if (done % 20 === 0 || done === sized.length) {
        process.stdout.write(`\r[3/4] 股东户数 ${done}/${sized.length}`);
      }
      if (!h || h.holderNum == null) return;
      if (h.holderNum > opts.maxHolders) return;
      if (
        opts.minTop10Ratio > 0 &&
        h.top10Ratio != null &&
        h.top10Ratio < opts.minTop10Ratio
      ) {
        return;
      }
      withHolder.push({ ...row, ...h });
    } catch {
      done++;
    }
  });
  process.stdout.write('\n');
  withHolder.sort((a, b) => (a.holderNum || 0) - (b.holderNum || 0));
  console.log(`[3/4] 股东筛选通过 ${withHolder.length}`);

  const finalRows = [];
  let kDone = 0;
  await mapPool(withHolder, Math.min(4, opts.concurrency), async (row) => {
    try {
      const klines = await fetchDailyKlines(row.code, 260);
      const analysis = analyzeVolumePrice(klines, opts, row);
      kDone++;
      if (kDone % 10 === 0 || kDone === withHolder.length) {
        process.stdout.write(`\r[4/4] 量价分析 ${kDone}/${withHolder.length}`);
      }
      if (!analysis || !analysis.pass) return;
      finalRows.push({ ...row, ...analysis });
    } catch {
      kDone++;
    }
  });
  process.stdout.write('\n');

  finalRows.sort((a, b) => {
    const score = (x) =>
      (x.volExpand5 || 0) * 2 +
      (x.volExpand10 || 0) +
      (x.top10Ratio || 0) / 50 -
      (x.vsYearAvg || 1);
    return score(b) - score(a);
  });

  // 补充近两年营收净利阶段 + 业务/合作方
  console.log(`[5/5] 财务与业务补全 ${finalRows.length} 只`);
  const enriched = [];
  let fDone = 0;
  await mapPool(finalRows, Math.min(4, opts.concurrency), async (row) => {
    try {
      const full = await enrichFundamentals(row);
      enriched.push(full);
    } catch {
      enriched.push(row);
    } finally {
      fDone++;
      if (fDone % 5 === 0 || fDone === finalRows.length) {
        process.stdout.write(`\r[5/5] 财务业务 ${fDone}/${finalRows.length}`);
      }
    }
  });
  process.stdout.write('\n');
  const order = new Map(finalRows.map((r, i) => [r.code, i]));
  enriched.sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
  finalRows.length = 0;
  finalRows.push(...enriched);

  const stageCount = {};
  for (const r of finalRows) {
    const s = r.profitStage || '数据不足';
    stageCount[s] = (stageCount[s] || 0) + 1;
  }
  console.log(
    '盈利阶段分布:',
    Object.entries(stageCount)
      .map(([k, v]) => `${k}${v}`)
      .join(' / ')
  );

  fs.mkdirSync(opts.outDir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-');
  const outPath = path.join(opts.outDir, `small-mainboard-${stamp}.xlsx`);
  writeExcel(finalRows, outPath, {
    generatedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    opts,
    stats: {
      mainBoard: all.length,
      afterSize: sized.length,
      afterHolder: withHolder.length,
      final: finalRows.length,
    },
  });

  const csvPath = outPath.replace(/\.xlsx$/i, '.csv');
  const excelRows = buildExcelRows(finalRows);
  if (excelRows.length) {
    const keys = Object.keys(excelRows[0]);
    const lines = [
      keys.join(','),
      ...excelRows.map((r) =>
        keys
          .map((k) => {
            const v = r[k] == null ? '' : String(r[k]);
            return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
          })
          .join(',')
      ),
    ];
    fs.writeFileSync(csvPath, '\ufeff' + lines.join('\n'), 'utf8');
  }

  console.log(`完成: ${finalRows.length} 只`);
  console.log(`Excel: ${outPath}`);
  if (excelRows.length) console.log(`CSV:   ${csvPath}`);
  if (finalRows.length) {
    console.log('Top 10:');
    for (const r of finalRows.slice(0, 10)) {
      console.log(
        `  ${r.code} ${r.name} [${r.profitStage || '-'}] 市值${fmtYi(r.marketCap)}亿 股东${r.holderNum} 量5=${pct(r.volExpand5)}x`
      );
    }
  } else {
    console.log('无结果。可加 --loose 放宽量价条件重试。');
  }
}


function matchesCompoundFilters(row, filters = {}) {
  const stage = String(filters.stage || '').trim();
  const focus = String(filters.focus || '').trim();
  const industry = String(filters.industry || '').trim().toLowerCase();
  const uncapped = filters.uncapped === true || filters.uncapped === 1 || filters.uncapped === '1' || filters.uncapped === 'true';
  const abnormal = filters.abnormal === true || filters.abnormal === 1 || filters.abnormal === '1' || filters.abnormal === 'true';
  if (stage && (row.profitStage || '') !== stage) return false;
  if (focus && (row.holdFocus || '') !== focus) return false;
  if (industry && !String(row.industry || '').toLowerCase().includes(industry)) return false;
  if (uncapped && !row.justUncapped) return false;
  if (abnormal && !row.hasAbnormal) return false;
  return true;
}

function hasCompoundFilters(filters = {}) {
  const stage = String(filters.stage || '').trim();
  const focus = String(filters.focus || '').trim();
  const industry = String(filters.industry || '').trim();
  const uncapped = filters.uncapped === true || filters.uncapped === 1 || filters.uncapped === '1' || filters.uncapped === 'true';
  const abnormal = filters.abnormal === true || filters.abnormal === 1 || filters.abnormal === '1' || filters.abnormal === 'true';
  return !!(stage || focus || industry || uncapped || abnormal);
}

/**
 * 在主板全市场按复合条件远程过滤（行业/盈利阶段/持股集中度/刚摘帽/异动）
 * 仅拉取条件所需接口，命中后再做完整基本面补全。
 */
async function remoteFilter(userFilters = {}, onProgress = () => {}) {
  const cfg = (require('../config').exportSmall) || {};
  const opts = { ...DEFAULTS, ...cfg, ...userFilters };
  const filters = {
    stage: String(userFilters.stage || '').trim(),
    focus: String(userFilters.focus || '').trim(),
    industry: String(userFilters.industry || '').trim(),
    uncapped:
      userFilters.uncapped === true ||
      userFilters.uncapped === 1 ||
      userFilters.uncapped === '1' ||
      userFilters.uncapped === 'true',
    abnormal:
      userFilters.abnormal === true ||
      userFilters.abnormal === 1 ||
      userFilters.abnormal === '1' ||
      userFilters.abnormal === 'true',
  };
  if (!hasCompoundFilters(filters)) {
    throw new Error('请至少选择一个条件：行业 / 盈利阶段 / 持股集中度 / 刚摘帽 / 异动');
  }

  const maxResults = Math.max(1, Number(userFilters.maxResults || opts.remoteMaxResults || 80));
  const concurrency = Math.max(2, Number(userFilters.concurrency || opts.concurrency || 6));
  const progress = (stage, payload = {}) => {
    try {
      onProgress(stage, payload);
    } catch {
      /* ignore */
    }
  };

  progress('clist', { message: '拉取主板列表', done: 0, total: 0 });
  const marketWeather = await fetchMarketWeather().catch(() => null);
  const all = await fetchMainBoardList(!!opts.includeST);
  progress('clist', { message: `主板 ${all.length} 只`, done: all.length, total: all.length, matched: all.length });

  let candidates = all.map((r) => ({ ...r }));

  // 0) 行业：clist 已有 f100，本地预过滤，缩小后续扫描范围
  if (filters.industry) {
    const key = filters.industry.toLowerCase();
    const before = candidates.length;
    candidates = candidates.filter((r) => String(r.industry || '').toLowerCase().includes(key));
    progress('clist', {
      message: `按行业预过滤「${filters.industry}」: ${before} → ${candidates.length}`,
      done: candidates.length,
      total: before,
      matched: candidates.length,
    });
  }

  // 1) 持股集中度：先拉股东户数，大幅缩小范围
  if (filters.focus) {
    const matched = [];
    let done = 0;
    const onlyFocus = !filters.stage && !filters.uncapped && !filters.abnormal;
    let stop = false;
    await mapPool(candidates, concurrency, async (row) => {
      if (stop) return;
      try {
        const h = await fetchHolderInfo(row.code);
        if (h && h.holdFocus === filters.focus) {
          matched.push({ ...row, ...h });
          if (onlyFocus && matched.length >= maxResults) stop = true;
        }
      } catch {
        /* ignore */
      } finally {
        done++;
        if (done % 30 === 0 || done === candidates.length || stop) {
          progress('holder', {
            message: `持股集中度扫描 ${Math.min(done, candidates.length)}/${candidates.length}，命中 ${matched.length}`,
            done: Math.min(done, candidates.length),
            total: candidates.length,
            matched: matched.length,
          });
        }
      }
    });
    candidates = onlyFocus ? matched.slice(0, maxResults) : matched;
    progress('holder_done', {
      message: `集中度「${filters.focus}」命中 ${candidates.length}${onlyFocus && stop ? '（已达上限）' : ''}`,
      matched: candidates.length,
      total: all.length,
    });
  }

  // 2) 盈利阶段：拉年报净利
  if (filters.stage && candidates.length) {
    const matched = [];
    let done = 0;
    const total = candidates.length;
    await mapPool(candidates, Math.min(concurrency, 6), async (row) => {
      try {
        const fin = await fetchAnnualFinance(row.code);
        const next = { ...row, ...fin };
        if ((next.profitStage || '') === filters.stage) matched.push(next);
      } catch {
        /* ignore */
      } finally {
        done++;
        if (done % 20 === 0 || done === total) {
          progress('finance', {
            message: `盈利阶段扫描 ${done}/${total}，命中 ${matched.length}`,
            done,
            total,
            matched: matched.length,
          });
        }
      }
    });
    candidates = matched;
    progress('finance_done', {
      message: `阶段「${filters.stage}」命中 ${candidates.length}`,
      matched: candidates.length,
    });
  }

  // 3) 刚摘帽 / 异动：公告扫描
  if ((filters.uncapped || filters.abnormal) && candidates.length) {
    const matched = [];
    let done = 0;
    const total = candidates.length;
    await mapPool(candidates, Math.min(concurrency, 5), async (row) => {
      try {
        const ann = await fetchAnnExtras(row.code, row.name);
        const next = { ...row, ...ann };
        let ok = true;
        if (filters.uncapped && !next.justUncapped) ok = false;
        if (filters.abnormal && !next.hasAbnormal) ok = false;
        if (ok) matched.push(next);
      } catch {
        /* ignore */
      } finally {
        done++;
        if (done % 15 === 0 || done === total) {
          progress('ann', {
            message: `公告扫描 ${done}/${total}，命中 ${matched.length}`,
            done,
            total,
            matched: matched.length,
          });
        }
      }
    });
    candidates = matched;
    progress('ann_done', {
      message: `公告条件命中 ${candidates.length}`,
      matched: candidates.length,
    });
  }

  // 若未拉过股东但展示需要，后面 enrich 会补；先截断上限
  const limited = candidates.slice(0, maxResults);
  progress('fundamentals', {
    message: `补全展示字段 ${limited.length} 只`,
    done: 0,
    total: limited.length,
  });

  const enriched = [];
  let fDone = 0;
  await mapPool(limited, Math.min(4, concurrency), async (row) => {
    try {
      // 缺股东时补一下，便于表格展示
      let base = row;
      if (base.holderNum == null) {
        const h = await fetchHolderInfo(row.code).catch(() => null);
        if (h) base = { ...base, ...h };
      }
      if (!base.profitStage && !filters.stage) {
        const fin = await fetchAnnualFinance(row.code).catch(() => ({}));
        base = { ...base, ...fin };
      }
      if (base.hasAbnormal == null && !filters.uncapped && !filters.abnormal) {
        const ann = await fetchAnnExtras(row.code, row.name).catch(() => ({}));
        base = { ...base, ...ann };
      }
      const full = await enrichFundamentals(base);
      if (matchesCompoundFilters(full, filters)) enriched.push(full);
    } catch {
      if (matchesCompoundFilters(row, filters)) enriched.push(row);
    } finally {
      fDone++;
      if (fDone % 5 === 0 || fDone === limited.length) {
        progress('fundamentals', {
          message: `补全 ${fDone}/${limited.length}`,
          done: fDone,
          total: limited.length,
          matched: enriched.length,
        });
      }
    }
  });

  return {
    rows: enriched,
    market: marketWeather,
    filters,
    stats: {
      mainBoard: all.length,
      afterFilter: enriched.length,
      scanned: all.length,
      truncated: candidates.length > maxResults,
      maxResults,
      stageCount: enriched.reduce((acc, r) => {
        const k = r.profitStage || '数据不足';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
    },
    opts: {
      includeST: !!opts.includeST,
      maxResults,
    },
    generatedAt: new Date().toISOString(),
    source: 'remote-filter',
  };
}

module.exports = {
  DEFAULTS,
  YI,
  runScreen,
  lookupStock,
  remoteFilter,
  hasCompoundFilters,
  matchesCompoundFilters,
  resolveOptions,
  buildExcelRows,
  writeExcel,
  isStName,
  classifyProfitStage,
  fetchMainBoardList,
};

if (require.main === module) {
  main().catch((e) => {
    console.error('导出失败:', e.message || e);
    process.exit(1);
  });
}
