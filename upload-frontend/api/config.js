const DEFAULT_TRUSTED_DOWNLOAD_HOST = 'api.openstmc.com';

function getTrustedDownloadHost(workerUrl = process.env['WORKER_URL'] || '') {
  if (workerUrl) {
    try {
      return new URL(workerUrl).hostname.toLowerCase();
    } catch (e) {
      // WORKER_URL 配置无效时忽略，退回默认域名
    }
  }

  return DEFAULT_TRUSTED_DOWNLOAD_HOST;
}

const TRUSTED_DOWNLOAD_HOST = getTrustedDownloadHost();

module.exports = {
  TRUSTED_DOWNLOAD_HOST,
  getTrustedDownloadHost
};
