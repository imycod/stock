require('../loadEnv').loadEnv();
const config = require('../../config');

function aiConfig() {
  const ai = config.ai || {};
  return {
    provider: ai.provider || 'zhipu',
    baseUrl: String(ai.baseUrl || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, ''),
    apiKey: String(ai.apiKey || process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY || '').trim(),
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractContent(json) {
  const msg = json?.choices?.[0]?.message || {};
  let content = msg.content;
  if (Array.isArray(content)) {
    content = content
      .map((p) => (typeof p === 'string' ? p : p?.text || p?.content || ''))
      .join('');
  }
  content = String(content || '').trim();
  const reasoning = String(msg.reasoning_content || msg.reasoning || '').trim();
  if (!content && reasoning) content = reasoning;
  return { content, reasoning, message: msg };
}

function isRetryableError(msg) {
  return /访问量过大|稍后再试|rate limit|429|超时|timeout|ECONNRESET|fetch failed|503|502|busy/i.test(
    String(msg || '')
  );
}

async function chatCompletions({ messages, temperature, maxTokens, thinking = false }) {
  const c = aiConfig();
  if (!c.apiKey) {
    const err = new Error('未配置智谱 API Key，请在项目根目录 .env 设置 ZHIPU_API_KEY 后重启服务');
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
  // flash 免费模型高峰易限流；默认关闭 thinking 降低失败率
  if (thinking) body.thinking = { type: 'enabled' };

  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + c.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('智谱接口返回非 JSON: HTTP ' + res.status + ' ' + text.slice(0, 160));
      }
      if (!res.ok) {
        const msg =
          json.error?.message || json.msg || json.message || 'HTTP ' + res.status;
        const err = new Error('智谱接口错误: ' + msg);
        err.retryable = isRetryableError(msg) || res.status === 429 || res.status >= 500;
        throw err;
      }
      const extracted = extractContent(json);
      if (!extracted.content) {
        throw new Error('模型返回空内容，请重试或换个问题');
      }
      return {
        content: extracted.content,
        reasoning: extracted.reasoning || '',
        raw: json,
        model: json.model || c.model,
        usage: json.usage || null,
      };
    } catch (e) {
      lastErr = e;
      const retryable = e.retryable || isRetryableError(e.message);
      if (!retryable || attempt >= 3) break;
      await sleep(1500 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

module.exports = {
  aiConfig,
  publicAiConfig,
  chatCompletions,
};
