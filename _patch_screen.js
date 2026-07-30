const fs = require('fs');
const path = require('path');

// ========== 1) Patch exportSmall.js ==========
let src = fs.readFileSync('src/exportSmall.js', 'utf8');

// DEFAULTS: add includeST
if (!src.includes('includeST:')) {
  src = src.replace(
    'maxPriceVsYearLow: 1.25,\n  concurrency: 6,',
    "maxPriceVsYearLow: 1.25,\n  includeST: false, // CLI 默认排除；Web 可打开\n  concurrency: 6,"
  );
}

// Better ST name check
src = src.replace(
  `function isStName(name) {
  return /ST|退/i.test(String(name || ''));
}`,
  `function isStName(name) {
  return /\\*?ST|\\*ST/.test(String(name || ''));
}

function stTypeOf(name) {
  const n = String(name || '');
  if (/\\*ST/.test(n)) return '退市风险警示(*ST)';
  if (/ST/.test(n)) return '其他风险警示(ST)';
  return '';
}`
);

// fetchMainBoardList(includeST)
src = src.replace(
  'async function fetchMainBoardList() {',
  'async function fetchMainBoardList(includeST = false) {'
);
src = src.replace(
  'if (!isMainBoardCode(code) || isStName(name)) continue;',
  'if (!isMainBoardCode(code)) continue;\n      if (!includeST && isStName(name)) continue;'
);

// Insert ST fetch helpers before enrichFundamentals
const stHelpers = `
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
        \`sr=-1&page_size=50&page_index=\${page}&ann_type=A&stock_list=\${code}&f_node=0&s_node=0\`;
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
          \`https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=\${impl.art_code}&client_source=web\`,
          { ...HEADERS, Referer: 'https://data.eastmoney.com/notices/' },
          15000,
          1
        );
        const content = String(detail.data?.notice_content || '').replace(/\\s+/g, ' ');
        const mDate =
          content.match(/实施起始日[为是]?\\s*(\\d{4}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日)/) ||
          content.match(/实施风险警示的起始日[:：]?\\s*(\\d{4}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日)/);
        if (mDate) {
          stDate = mDate[1].replace(/\\s+/g, '').replace(/年|月/g, '-').replace(/日/, '');
          // normalize 2026-4-29 -> 2026-04-29
          const p = stDate.split('-');
          if (p.length === 3) {
            stDate = \`\${p[0]}-\${p[1].padStart(2, '0')}-\${p[2].padStart(2, '0')}\`;
          }
        }
        const mReason =
          content.match(/因([^。]{10,120}?)(?:根据|将被实施|公司股票将被实施)/) ||
          content.match(/适用情形[\\s\\S]{0,40}?([\\u4e00-\\u9fa5A-Za-z0-9，,]{20,160}?)(?:根据|。)/);
        if (mReason) stReason = mReason[1].replace(/\\s+/g, '').slice(0, 120);
        if (!stReason) {
          const tip = content.match(/重要内容提示[：:]([\\s\\S]{20,200}?)(?:本公司的相关证券|第一节)/);
          if (tip) stReason = tip[1].replace(/\\s+/g, '').slice(0, 120);
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

`;

if (!src.includes('async function fetchStInfo')) {
  src = src.replace(
    'async function enrichFundamentals(row) {',
    stHelpers + 'async function enrichFundamentals(row) {'
  );
}

// enrichFundamentals: also fetch ST for ST names
src = src.replace(
  `async function enrichFundamentals(row) {
  const [fin, biz] = await Promise.all([
    fetchAnnualFinance(row.code).catch(() => ({})),
    fetchCompanyBusiness(row.code, row.name).catch(() => ({})),
  ]);
  return { ...row, ...fin, ...biz };
}`,
  `async function enrichFundamentals(row) {
  const tasks = [
    fetchAnnualFinance(row.code).catch(() => ({})),
    fetchCompanyBusiness(row.code, row.name).catch(() => ({})),
  ];
  if (isStName(row.name)) tasks.push(fetchStInfo(row.code, row.name).catch(() => ({})));
  const [fin, biz, st] = await Promise.all(tasks);
  return { ...row, ...fin, ...biz, ...(st || { isST: false }) };
}`
);

// Add ST columns to excel
if (!src.includes('是否ST:')) {
  src = src.replace(
    '业务简介: r.businessBrief || \'\',\n    总股本亿股:',
    `业务简介: r.businessBrief || '',
    是否ST: r.isST ? '是' : '否',
    ST类型: r.stType || '',
    ST实施日: r.stDate || '',
    ST原因: r.stReason || '',
    预计摘帽: r.stRemoveEstimate || '',
    总股本亿股:`
  );
}

// Replace main() body usage + add runScreen + exports
// Change fetchMainBoardList() call in main
src = src.replace(
  'const all = await fetchMainBoardList();',
  'const all = await fetchMainBoardList(!!opts.includeST);'
);

// Add runScreen before main, and module.exports; guard main for CLI
const runScreenCode = `
/**
 * 可编程筛选入口（Web / CLI 共用）
 * @param {object} userOpts
 * @param {(stage:string, payload:object)=>void} onProgress
 */
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

`;

if (!src.includes('async function runScreen')) {
  src = src.replace('async function main() {', runScreenCode + 'async function main() {');
}

// Guard CLI main
src = src.replace(
  `main().catch((e) => {
  console.error('导出失败:', e.message || e);
  process.exit(1);
});`,
  `module.exports = {
  DEFAULTS,
  YI,
  runScreen,
  resolveOptions,
  buildExcelRows,
  writeExcel,
  isStName,
  classifyProfitStage,
};

if (require.main === module) {
  main().catch((e) => {
    console.error('导出失败:', e.message || e);
    process.exit(1);
  });
}`
);

fs.writeFileSync('src/exportSmall.js', src);
console.log('exportSmall patched', fs.statSync('src/exportSmall.js').size);
