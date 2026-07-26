const test = require('node:test');
const assert = require('node:assert/strict');
const { getTrustedDownloadHost } = require('./config');

test('uses the default hostname when WORKER_URL is absent or invalid', () => {
  assert.equal(getTrustedDownloadHost(''), 'api.openstmc.com');
  assert.equal(getTrustedDownloadHost('not a URL'), 'api.openstmc.com');
});

test('derives a lowercase hostname from WORKER_URL', () => {
  assert.equal(
    getTrustedDownloadHost('https://Uploads.OpenSTMC.com/api'),
    'uploads.openstmc.com'
  );
});
