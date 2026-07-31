const config = require('../../config');

function aiConfig() {
  const ai = config.ai || {};
  return {
    provider: ai.provider || 'zhipu',
    baseUrl: String(ai.baseUrl || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, ''),
    apiKey: String(ai.apiKey || process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY || ''),
    model: ai.model || 'glm-4.7-flash',
    defaultDays: Number(ai.defaultDays || 5),
    maxDays: Number(ai.maxDays || 10),
    maxRows: Number(ai.maxRows || 900),
    temperature: Number(ai.temperature ?? 0.6),
    maxTokens: Number(ai.maxTokens || 4096),
  };
}

function publicAiConfig() {
  const c = aiConfig();
  return {
    provider: c.provider,
    model: c.model,
    defaultDays: c.defaultDays,
    maxDays: c.maxDays,
    configured: !!c.apiKey,
    presets: [
      '分析主力意图',
      '分析今天集合竞价阶段的分时与量能特征',
      '从分时数据判断今天更像出货还是洗盘，给出依据',
      '从最近半小时的量能和换手率判断多空力量',
      '总结近几日量价与资金流节奏，给出关注点',
    ],
  };
}

async function chatCompletions({ messages, temperature, maxTokens, thinking = false }) {
  const c = aiConfig();
  if (!c.apiKey) {
    const err = new Error('未配置智谱 API Key，请设置环境变量 ZHIPU_API_KEY');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  const url = c.baseUrl + '/chat/completions';
  const body = {
    model: c.model,
    messages,
    temperature: temperature ?? c.temperature,
    max_tokens: maxTokens ?? c.maxTokens,
  };
  if (thinking) body.thinking = { type: 'enabled' };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + c.apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('智谱接口返回非 JSON: HTTP ' + res.status);
  }
  if (!res.ok) {
    const msg = json.error?.message || json.msg || json.message || ('HTTP ' + res.status);
    throw new Error('智谱接口错误: ' + msg);
  }
  const choice = json.choices?.[0]?.message || {};
  return {
    content: choice.content || '',
    reasoning: choice.reasoning_content || '',
    raw: json,
    model: json.model || c.model,
    usage: json.usage || null,
  };
}

module.exports = {
  aiConfig,
  publicAiConfig,
  chatCompletions,
};
