(async () => {
  const headers = {
    "User-Agent": "Mozilla/5.0",
    Referer: "https://data.eastmoney.com/",
  };
  async function get(url, h=headers) {
    const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return {_raw:t.slice(0,300)}; }
  }

  const tries = [
    // ST risk list page
    'https://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=SECURITY_CODE&sortTypes=1&pageSize=5&pageNumber=1&reportName=RPT_CUSTOM_ENTRY_PLATE_ST&columns=ALL&source=WEB&client=WEB',
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_STLIST&columns=ALL&pageNumber=1&pageSize=5&source=WEB&client=WEB',
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_STK_ST_LIST&columns=ALL&pageNumber=1&pageSize=5&source=WEB&client=WEB',
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_PUBLIC_OP_STLIST&columns=ALL&pageNumber=1&pageSize=5&source=WEB&client=WEB',
    // notice search for ST
    'https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=5&page_index=1&ann_type=A&stock_list=600759&f_node=0&s_node=0',
    // company survey + risk
    'https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=SH600759',
    // capital operation / risk tip
    'https://emweb.securities.eastmoney.com/PC_HSF10/CapitalOperation/PageAjax?code=SH600759',
    'https://emweb.securities.eastmoney.com/PC_HSF10/StockHolderNumber/PageAjax?code=SH600759',
  ];

  for (const u of tries) {
    const j = await get(u, u.includes('emweb') ? {...headers, Referer:'https://emweb.securities.eastmoney.com/'} : headers);
    const label = u.includes('reportName=') ? u.match(/reportName=([^&]+)/)[1] : u.split('/').slice(-2).join('/').slice(0,60);
    console.log('\n==', label, 'success', j.success, 'keys', Object.keys(j).slice(0,12), 'msg', (j.message||'').slice(0,80));
    if (j.result?.data?.[0]) console.log(JSON.stringify(j.result.data[0]).slice(0,500));
    if (j.jbzl) console.log('jbzl expand', j.jbzl[0]?.EXPAND_NAME_ABBR, j.jbzl[0]?.SECURITY_NAME_ABBR);
    if (j.data && !j.result) console.log(JSON.stringify(j.data).slice(0,400));
  }

  // search ST via clist - f100 industry, name has ST
  const clist = await get('https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:1+t:2,m:0+t:6&fields=f12,f14,f2,f3,f20,f38&ut=fa5fd1943c7b386f172d6893dbfba107');
  const st = (clist.data?.diff||[]).filter(x=>/ST/.test(x.f14));
  console.log('\nst in first page', st.length);

  // eastmoney risk warning /退市风险
  const riskNames = [
    'RPT_CUSTOM_PLEDGE_ST','RPTA_APP_RISKTIP','RPT_F10_RISKTIP','RPT_LICO_FN_ST','RPT_STK_RISKWARNING',
    'RPT_PUBLIC_OP_RISKWARNING','RPTA_WEB_RISKWARNING','RPT_HSF10_REMINDER'
  ];
  for (const name of riskNames) {
    const u = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=${name}&columns=ALL&filter=${encodeURIComponent('(SECUCODE="600759.SH")')}&pageNumber=1&pageSize=3&source=HSF10&client=PC`;
    const j = await get(u);
    console.log(name, j.success, j.message||'', j.result?.data ? JSON.stringify(j.result.data).slice(0,300) : '');
  }
})().catch(console.error);
