const fs = require('fs');
const path = require('path');

/**
 * 轻量加载项目根目录 .env（不覆盖已有 process.env）
 */
function loadEnv(filePath) {
  const envPath = filePath || path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return { ok: false, reason: 'missing' };
  const text = fs.readFileSync(envPath, 'utf8');
  let count = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!key) continue;
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = val;
      count++;
    }
  }
  return { ok: true, count, path: envPath };
}

module.exports = { loadEnv };
