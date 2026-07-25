/**
 * Vercel Route API — 令牌校验
 * GET /api/validate?t=<28chars>
 *
 * 令牌格式: timestamp(11hex) + nonce(9hex) + hmac(8hex)
 */
const crypto = require('crypto');
const TOKEN_TTL_MS = 30 * 60 * 1000;

function verifyToken(token) {
  if (!token || token.length !== 28) return false;

  var payload = token.slice(0, 20);
  var providedHmac = token.slice(20, 28);
  var ts = parseInt(payload.slice(0, 11), 16);

  if (isNaN(ts)) return false;
  if (Date.now() - ts > TOKEN_TTL_MS) return false;

  var secret = process.env.UPLOAD_SECRET || '';
  if (!secret) return false;

  var expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
    .slice(0, 8);

  return providedHmac === expected;
}

module.exports = function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ valid: false });

  var token = (req.query.t || '').toString();
  var valid = verifyToken(token);

  res.status(valid ? 200 : 403).json({
    valid: valid,
    expiresIn: valid ? TOKEN_TTL_MS : 0
  });
};
