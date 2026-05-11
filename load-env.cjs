/**
 * Load .env and .env.local into process.env (same paths for auth-server, meshcentral-api, sync script).
 */
const path = require('path');
const fs = require('fs');

const files = [path.join(__dirname, '.env'), path.join(__dirname, '.env.local')];
for (const filePath of files) {
  try {
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, 'utf8');
    for (const line of src.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key) process.env[key] = val;
    }
  } catch (e) {
    console.warn('[load-env]', filePath, e.message);
  }
}
