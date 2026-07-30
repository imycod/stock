(async () => {
  const headers = {
    "User-Agent": "Mozilla/5.0",
    Referer: "https://data.eastmoney.com/",
  };
  async function get(url) {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    return r.json();
  }
  // ST list / risk warning
  const reports = [
    ["RPT_LICO_ZS_ST", '(SECURITY_CODE="600759")'],
    ["RPT_ST_LIST", ''],
    ["RPTA_APP_LITIGATIONINFO", '(SECURITY_CODE="600759")'],
    ["RPT_F10_ORG_SPECIALTREAT", '(SECUCODE="600759.SH")'],
    ["RPT_DMSK_TSZL", '(SECURITY_CODE="600759")'],
  ];
  for (const [name, filter] of reports) {
    let u = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${name}&columns=ALL&pageNumber=1&pageSize=3&source=WEB&client=WEB`;
    if (filter) u += `&filter=${encodeURIComponent(filter)}`;
    const j = await get(u);
    console.log(name, j.success, j.message||"", j.result?.data?.[0] ? Object.keys(j.result.data[0]).slice(0,20).join(',') : '');
    if (j.result?.data?.[0]) console.log(JSON.stringify(j.result.data[0]).slice(0,400));
  }

  // HSF10 risk / ST
  const u2 = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_ORG_SPECIALTREAT&columns=ALL&filter=${encodeURIComponent('(SECUCODE="600759.SH")')}&pageNumber=1&pageSize=5&source=HSF10&client=PC`;
  const j2 = await get(u2);
  console.log('\nHSF10 ST', j2.success, j2.message, JSON.stringify(j2.result?.data)?.slice(0,800));

  // Operations required for ST stock
  const op = await get('https://emweb.securities.eastmoney.com/PC_HSF10/OperationsRequired/PageAjax?code=SH600759');
  console.log('\nop keys', Object.keys(op));
  console.log('tszb', JSON.stringify(op.tszb)?.slice(0,1000));
  console.log('zxzbOther', JSON.stringify(op.zxzbOther)?.slice(0,400));
})().catch(console.error);
