/**
 * Vercel Route API — 创建 GitHub Issue
 * POST /api/submit?t=<token>&g=<enc_gh>
 * Body: { name, author, contact, desc, tags, downloadUrl, infoJson }
 *
 * 不处理文件上传，文件已由前端直接 POST 到 Worker
 */
const crypto = require('crypto');
const axios = require('axios');
const { TRUSTED_DOWNLOAD_HOST } = require('./config');

const TOKEN_TTL_MS = 30 * 60 * 1000;
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

function deriveKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function verifyToken(token, secret) {
  if (!token || token.length !== 28) return false;
  var payload = token.slice(0, 20);
  var providedHmac = token.slice(20, 28);
  var ts = parseInt(payload.slice(0, 11), 16);
  if (isNaN(ts)) return false;
  if (Date.now() - ts > TOKEN_TTL_MS) return false;

  var expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
    .slice(0, 8);
  return providedHmac === expected;
}

function decryptGhToken(encrypted, secret) {
  if (!encrypted) return '';
  var buf = Buffer.from(encrypted, 'base64url');
  var iv = buf.slice(0, 12);
  var authTag = buf.slice(12, 28);
  var ciphertext = buf.slice(28);
  var key = deriveKey(secret);

  var decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('utf8');
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  var secret = process.env.UPLOAD_SECRET || '';
  var accessToken = (req.query.t || '').toString();
  var encGh = (req.query.g || '').toString();

  if (!verifyToken(accessToken, secret)) {
    return res.status(403).json({ error: '无效或已过期的令牌' });
  }

  var ghToken = decryptGhToken(encGh, secret);
  if (!ghToken) {
    return res.status(400).json({ error: '无法解密 GitHub 令牌' });
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

module.exports = handler;
