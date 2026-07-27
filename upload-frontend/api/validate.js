/**
 * Vercel Route API — 令牌校验
 * GET /api/validate?t=<token>
 *
 * 令牌格式: timestamp + nonce + hmac，各段长度见 TOKEN_*_HEX_LEN 常量。
 *
 * 这些常量（以及 TOKEN_TTL_MS）必须与 src/upload/server.ts、
 * upload-frontend/api/submit.js 中的同名常量保持一致——三处分属不同部署环境
 * （bot 进程 / Vercel Serverless Function），无法共享同一份源码，修改任一处时
 * 必须同步修改另外两处，否则会因为长度或有效期对不上导致验证失败。
 */
const crypto = require('crypto');

const TOKEN_TIMESTAMP_HEX_LEN = 11;
const TOKEN_NONCE_HEX_LEN = 9;
const TOKEN_HMAC_HEX_LEN = 16;
const TOKEN_PAYLOAD_LEN = TOKEN_TIMESTAMP_HEX_LEN + TOKEN_NONCE_HEX_LEN;
const TOKEN_TOTAL_LEN = TOKEN_PAYLOAD_LEN + TOKEN_HMAC_HEX_LEN;
const TOKEN_TTL_MS = 5 * 60 * 1000;

function verifyToken(token) {
  if (!token || token.length !== TOKEN_TOTAL_LEN) return false;

  var payload = token.slice(0, TOKEN_PAYLOAD_LEN);
  var providedHmac = token.slice(TOKEN_PAYLOAD_LEN, TOKEN_TOTAL_LEN);
  var ts = parseInt(payload.slice(0, TOKEN_TIMESTAMP_HEX_LEN), 16);

  if (isNaN(ts)) return false;
  if (Date.now() - ts > TOKEN_TTL_MS) return false;

  var secret = process.env.UPLOAD_SECRET || '';
  if (!secret) return false;

  var expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
    .slice(0, TOKEN_HMAC_HEX_LEN);

  return providedHmac === expected;
}

function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ valid: false });

  var token = (req.query.t || '').toString();
  var valid = verifyToken(token);

  res.status(valid ? 200 : 403).json({
    valid: valid,
    expiresIn: valid ? TOKEN_TTL_MS : 0
  });
}

// 挂载到导出函数上以便单元测试直接调用，不改变默认导出的调用方式
handler.verifyToken = verifyToken;
handler.TOKEN_TOTAL_LEN = TOKEN_TOTAL_LEN;
handler.TOKEN_PAYLOAD_LEN = TOKEN_PAYLOAD_LEN;
handler.TOKEN_TIMESTAMP_HEX_LEN = TOKEN_TIMESTAMP_HEX_LEN;
handler.TOKEN_HMAC_HEX_LEN = TOKEN_HMAC_HEX_LEN;
handler.TOKEN_TTL_MS = TOKEN_TTL_MS;

module.exports = handler;
