const test = require('node:test');
const assert = require('node:assert/strict');

const { DashboardService } = require('../../src/services/dashboardservice');

const createMockSdk = () => ({
  ok: async (promise) => promise,
});

test('DashboardService merges config overrides with defaults', async () => {
  const service = new DashboardService(createMockSdk(), { folderName: 'Custom Folder', limitResults: 10 });
  assert.equal(service.config.folderName, 'Custom Folder');
  assert.equal(service.config.limitResults, 10);
});

test('DashboardService throws when SDK is missing', async () => {
  assert.throws(() => new DashboardService(null), {
    message: 'Looker SDK instance is required to use DashboardService.',
  });
});
