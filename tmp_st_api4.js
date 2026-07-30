(async () => {
  const headers = {
    "User-Agent": "Mozilla/5.0",
    Referer: "https://data.eastmoney.com/",
  };
  async function get(url) {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    return r.json();
  }

  // Search ST implementation announcements for 600759
  const urls = [
    `https://search-api-web.eastmoney.com/search/jsonp?cb=a&param=${encodeURIComponent(JSON.stringify({uid:'','keyword':'实施退市风险警示 600759','type':['cmsArticleWebOld'],'client':'web','clientType':'web','clientVersion':'curr','param':{'cmsArticleWebOld':{'searchScope':'default','sort':'default','pageIndex':1,'pageSize':5}}}))}`,
  ];

  // stock notice with keyword filter via eastmoney notice
  const ann = await get('https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=50&page_index=1&ann_type=A&stock_list=600759&f_node=1&s_node=0');
  console.log('f_node=1 count', ann.data?.list?.length);
  for (const a of (ann.data?.list||[]).slice(0,20)) console.log(a.notice_date?.slice(0,10), a.title);

  // Try all historical with search in title client-side - get more pages
  let found = [];
  for (let page=1; page<=5; page++) {
    const j = await get(`https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=50&page_index=${page}&ann_type=A&stock_list=600759&f_node=0&s_node=0`);
    for (const a of j.data?.list||[]) {
      if (/ST|风险警示|摘帽|撤销.*警示|其他风险警示|退市风险/.test(a.title||'')) {
        found.push(`${a.notice_date?.slice(0,10)} ${a.title}`);
      }
    }
  }
  console.log('\nST related anns:');
  found.slice(0,30).forEach(x=>console.log(x));

  // Try 同花顺 / sina ST info
  const sina = await get('https://hq.sinajs.cn/list=sh600759').catch(()=>null);
  
  // eastmoney stock page config
  const cfg = await get('https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvery/PageAjax?code=SH600759').catch(e=>({err:e.message}));
  
  // Check dstx events for ST
  const op = await get('https://emweb.securities.eastmoney.com/PC_HSF10/OperationsRequired/PageAjax?code=SH600759');
  const flat = [];
  for (const day of (op.dstx?.data||[])) {
    for (const ev of day) {
      if (/ST|警示|摘帽|退市/.test(JSON.stringify(ev))) flat.push(ev);
    }
  }
  console.log('\ndstx ST events', flat.length);
  console.log(JSON.stringify(flat.slice(0,5), null, 2).slice(0,1500));
})().catch(console.error);
