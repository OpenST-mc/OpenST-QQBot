// bot 与 Vercel API 的令牌格式测试（HMAC 长度加长、有效期缩短）
// 使用 Node 内置 test runner（无需新增依赖）
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');

process.env.UPLOAD_SECRET = 'test-secret';

const validateHandler = require('./validate');
const submitHandler = require('./submit');
const botServerPath = path.resolve(__dirname, '../../dist/upload/server.js');

function loadBotServer(secret) {
  if (secret) {
    process.env.UPLOAD_SECRET = secret;
  } else {
    delete process.env.UPLOAD_SECRET;
  }

  delete require.cache[require.resolve(botServerPath)];
  return require(botServerPath);
}

// 按当前 TOKEN_*_HEX_LEN 常量构造一个合法 token，方便测试用例复用
function buildValidToken(handler, secret, timestampMs) {
  const ts = (timestampMs !== undefined ? timestampMs : Date.now())
    .toString(16)
    .padStart(handler.TOKEN_TIMESTAMP_HEX_LEN, '0')
    .slice(0, handler.TOKEN_TIMESTAMP_HEX_LEN);
  const nonce = 'abcdef123'.slice(0, handler.TOKEN_PAYLOAD_LEN - handler.TOKEN_TIMESTAMP_HEX_LEN);
  const payload = ts + nonce;
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
    .slice(0, handler.TOKEN_HMAC_HEX_LEN);
  return payload + hmac;
}

for (const [name, handler] of [['validate.js', validateHandler], ['submit.js', submitHandler]]) {
  test(`${name}: 令牌长度已加长到 ${11 + 9 + 16} 字符（64 bit HMAC）`, () => {
    assert.strictEqual(handler.TOKEN_HMAC_HEX_LEN, 16);
    assert.strictEqual(handler.TOKEN_TOTAL_LEN, 11 + 9 + 16);
  });

  test(`${name}: 有效期已缩短到 5 分钟`, () => {
    assert.strictEqual(handler.TOKEN_TTL_MS, 5 * 60 * 1000);
  });

  test(`${name}: 旧格式（28 字符，32 bit HMAC）token 被拒绝`, () => {
    const ts = Date.now().toString(16).padStart(11, '0').slice(0, 11);
    const nonce = 'abcdef123';
    const payload = ts + nonce;
    const oldHmac = crypto
      .createHmac('sha256', 'test-secret')
      .update(payload)
      .digest('hex')
      .slice(0, 8);
    const oldToken = payload + oldHmac; // 28 字符，长度对不上新常量
    assert.strictEqual(handler.verifyToken(oldToken, 'test-secret'), false);
  });

  test(`${name}: 篡改 HMAC 的 token 被拒绝`, () => {
    const token = buildValidToken(handler, 'test-secret');
    const tampered = token.slice(0, -1) + (token.slice(-1) === '0' ? '1' : '0');
    assert.strictEqual(handler.verifyToken(tampered, 'test-secret'), false);
  });

  test(`${name}: 超过有效期（5 分钟前签发）的 token 被拒绝`, () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    const token = buildValidToken(handler, 'test-secret', sixMinutesAgo);
    assert.strictEqual(handler.verifyToken(token, 'test-secret'), false);
  });
}

test('bot 生成的 token 可被 validate.js 与 submit.js 验证', () => {
  const botServer = loadBotServer('test-secret');
  const token = botServer.generateToken();

  assert.match(token, /^[0-9a-f]{36}$/);
  assert.strictEqual(validateHandler.verifyToken(token), true);
  assert.strictEqual(submitHandler.verifyToken(token, 'test-secret'), true);
});

test('未设置 UPLOAD_SECRET 时 bot 拒绝生成 token', () => {
  const botServer = loadBotServer('');

  try {
    assert.throws(
      () => botServer.generateToken(),
      /UPLOAD_SECRET 未設定/
    );
  } finally {
    process.env.UPLOAD_SECRET = 'test-secret';
  }
});
