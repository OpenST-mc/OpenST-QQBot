/**
 * Vercel Route API — 创建 GitHub Issue
 * POST /api/submit?t=<token>
 * Body: { name, author, contact, desc, tags, downloadUrl, infoJson }
 *
 * 不处理文件上传，文件已由前端直接 POST 到 Worker
 *
 * 令牌格式常量（TOKEN_*_HEX_LEN、TOKEN_TTL_MS）必须与 src/upload/server.ts、
 * upload-frontend/api/validate.js 中的同名常量保持一致——三处分属不同部署环境
 * （bot 进程 / Vercel Serverless Function），无法共享同一份源码，修改任一处时
 * 必须同步修改另外两处，否则会因为长度或有效期对不上导致验证失败。
 */
const crypto = require('crypto');
const axios = require('axios');
const { TRUSTED_DOWNLOAD_HOST } = require('./config');

const TOKEN_TIMESTAMP_HEX_LEN = 11;
const TOKEN_NONCE_HEX_LEN = 9;
const TOKEN_HMAC_HEX_LEN = 16;
const TOKEN_PAYLOAD_LEN = TOKEN_TIMESTAMP_HEX_LEN + TOKEN_NONCE_HEX_LEN;
const TOKEN_TOTAL_LEN = TOKEN_PAYLOAD_LEN + TOKEN_HMAC_HEX_LEN;
const TOKEN_TTL_MS = 5 * 60 * 1000;
// downloadUrl 完全由前端提交、未经验证，写入 issue 前需校验来源域名，
// 否则可被伪造成任意地址（含内网地址），造成审核端下载时的 SSRF 风险

function isTrustedDownloadUrl(urlStr) {
  if (!urlStr) return true;
  try {
    var host = new URL(urlStr).hostname.toLowerCase();
    var trusted = TRUSTED_DOWNLOAD_HOST.toLowerCase();
    return host === trusted || host.endsWith('.' + trusted);
  } catch (e) {
    return false;
  }
}

function verifyToken(token, secret) {
  if (!secret) return false;
  if (!token || token.length !== TOKEN_TOTAL_LEN) return false;
  var payload = token.slice(0, TOKEN_PAYLOAD_LEN);
  var providedHmac = token.slice(TOKEN_PAYLOAD_LEN, TOKEN_TOTAL_LEN);
  var ts = parseInt(payload.slice(0, TOKEN_TIMESTAMP_HEX_LEN), 16);
  if (isNaN(ts)) return false;
  if (Date.now() - ts > TOKEN_TTL_MS) return false;

  var expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
    .slice(0, TOKEN_HMAC_HEX_LEN);
  return providedHmac === expected;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  var secret = process.env.UPLOAD_SECRET || '';
  var accessToken = (req.query.t || '').toString();

  if (!verifyToken(accessToken, secret)) {
    return res.status(403).json({ error: '无效或已过期的令牌' });
  }

  var ghToken = process.env['GITHUB_TOKEN'] || '';
  if (!ghToken) {
    return res.status(500).json({ error: 'GitHub 投稿凭证未配置' });
  }

  var body = req.body || {};
  var name = String(body.name || '').trim();
  var author = String(body.author || '').trim();
  var contact = String(body.contact || '').trim();
  var desc = String(body.desc || '').trim();
  var downloadUrl = String(body.downloadUrl || '').trim();
  var infoJson = body.infoJson || {};
  var tags = Array.isArray(body.tags) ? body.tags : [];

  if (!name || !author) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  if (!isTrustedDownloadUrl(downloadUrl)) {
    return res.status(400).json({ error: '下载链接域名不受信任' });
  }

  try {
    var dlSection = downloadUrl
      ? '> [!IMPORTANT]\n' +
        '> **存档审核直连下载 (国内加速)**: ' +
        '[点击下载投稿全量包](' + downloadUrl + ')\n'
      : '';

    var issueBody =
      '## Machine Submission: ' + name + '\n\n' +
      dlSection +
      '\n### Info (info.json)\n' +
      '```json\n' +
      JSON.stringify(infoJson, null, 4) +
      '\n```\n' +
      '\n---\n' +
      '**Submission Details**\n' +
      '- **Author**: ' + author + '\n' +
      '- **Contact**: ' + (contact || 'Not provided') + '\n' +
      '- **Tags**: ' + (tags.length ? tags.join(', ') : 'None') + '\n' +
      '- **Description**: \n' + desc + '\n\n' +
      '_Submitted via OpenST QQ Bot_';

    var ghRes = await axios.post(
      'https://api.github.com/repos/OpenST-mc/Submissions/issues',
      {
        title: '[OpenST] ' + name + ' @' + author,
        labels: ['bot-submission'],
        body: issueBody
      },
      {
        headers: {
          Authorization: 'Bearer ' + ghToken,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    res.json({
      success: true,
      subId: (infoJson.id || ''),
      issueUrl: ghRes.data && ghRes.data.html_url
    });
  } catch (err) {
    console.error('[Submit] GitHub Issue failed:', err.message);
    res.status(500).json({ error: 'GitHub Issue 创建失败' });
  }
}

// 挂载到导出函数上以便单元测试直接调用，不改变默认导出的调用方式
handler.verifyToken = verifyToken;
handler.TOKEN_TOTAL_LEN = TOKEN_TOTAL_LEN;
handler.TOKEN_PAYLOAD_LEN = TOKEN_PAYLOAD_LEN;
handler.TOKEN_TIMESTAMP_HEX_LEN = TOKEN_TIMESTAMP_HEX_LEN;
handler.TOKEN_HMAC_HEX_LEN = TOKEN_HMAC_HEX_LEN;
handler.TOKEN_TTL_MS = TOKEN_TTL_MS;

module.exports = handler;
