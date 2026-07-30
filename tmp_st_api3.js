(async () => {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Referer: "https://quote.eastmoney.com/",
  };
  async function get(url, h=headers) {
    const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return {_raw:t.slice(0,400)}; }
  }

  // ST board concept
  const boards = [
    'https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:BK0511&fields=f12,f14,f2,f3,f20,f38&ut=fa5fd1943c7b386f172d6893dbfba107', // ST股?
    'https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:BK0804&fields=f12,f14&ut=fa5fd1943c7b386f172d6893dbfba107',
  ];
  for (const u of boards) {
    const j = await get(u);
    console.log('board', u.match(/b:([^&]+)/)[1], 'total', j.data?.total, 'sample', j.data?.diff?.slice(0,3).map(x=>x.f12+x.f14));
  }

  // Search announcements about ST implementation
  const ann = await get('https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=20&page_index=1&ann_type=A&stock_list=600759&f_node=0&s_node=0');
  for (const a of (ann.data?.list||[]).slice(0,15)) {
    console.log(a.notice_date?.slice(0,10), a.title);
  }

  // try cninfo / eastmoney stock risk
  const urls = [
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_CUSTOM_ST_SECURITY&columns=ALL&pageNumber=1&pageSize=5&source=WEB&client=WEB',
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_APP_STSECURITY&columns=ALL&pageNumber=1&pageSize=5&source=WEB&client=WEB',
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_STSECURITY&columns=ALL&pageNumber=1&pageSize=5&source=WEB&client=WEB',
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_STOCK_ST&columns=ALL&pageNumber=1&pageSize=5&source=WEB&client=WEB',
    // 风险警示板
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_TRANSFER_SECURITY&columns=ALL&filter=(SECURITY_CODE=%22600759%22)&pageNumber=1&pageSize=5&source=WEB&client=WEB',
  ];
  for (const u of urls) {
    const j = await get(u);
    const name = u.match(/reportName=([^&]+)/)[1];
    console.log(name, j.success, j.message||'', j.result?.count);
    if (j.result?.data?.[0]) console.log(JSON.stringify(j.result.data[0]).slice(0,500));
  }

  // quote detail may have special treatment fields
  const q = await get('https://push2delay.eastmoney.com/api/qt/stock/get?secid=1.600759&invt=2&fltt=2&fields=f57,f58,f127,f152,f154,f292,f297,f301,f401,f402,f403,f404,f405,f406,f407,f408,f409,f410&ut=fa5fd1943c7b386f172d6893dbfba107');
  console.log('\nquote fields', JSON.stringify(q.data, null, 2));
})().catch(console.error);
