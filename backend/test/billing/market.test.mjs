import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMERCIAL_MARKETS, isCommercialMarket, MARKET_DEFAULT_CURRENCY, resolveCommercialMarket } from '../../dist/billing/market.js';

test('exactly three commercial markets: YEMEN, GULF, GLOBAL_OTHER', () => {
  assert.deepEqual([...COMMERCIAL_MARKETS].sort(), ['GLOBAL_OTHER', 'GULF', 'YEMEN']);
});

test('PCA-ADD-BILL-019 default currency mapping: YEMEN->YER, GULF->SAR, GLOBAL_OTHER->USD', () => {
  assert.equal(MARKET_DEFAULT_CURRENCY.YEMEN, 'YER');
  assert.equal(MARKET_DEFAULT_CURRENCY.GULF, 'SAR');
  assert.equal(MARKET_DEFAULT_CURRENCY.GLOBAL_OTHER, 'USD');
});

test('isCommercialMarket rejects unknown values', () => {
  assert.equal(isCommercialMarket('EUROPE'), false);
  assert.equal(isCommercialMarket('YEMEN'), true);
});

class FakeMarketMappingRepository {
  constructor(rules) {
    this.rules = new Map(rules.map((r) => [r.countryCode, r.commercialMarket]));
  }
  async resolveMarketForCountry(countryCode) {
    return this.rules.get(countryCode.toUpperCase()) ?? null;
  }
  async listRules() {
    return [...this.rules.entries()].map(([countryCode, commercialMarket]) => ({ countryCode, commercialMarket }));
  }
  async upsertRule() {
    throw new Error('not used in this test');
  }
}

test('resolveCommercialMarket uses the config-driven rule table, not a hardcoded country list', async () => {
  const repo = new FakeMarketMappingRepository([
    { countryCode: 'YE', commercialMarket: 'YEMEN' },
    { countryCode: 'SA', commercialMarket: 'GULF' },
  ]);
  assert.equal(await resolveCommercialMarket(repo, 'YE'), 'YEMEN');
  assert.equal(await resolveCommercialMarket(repo, 'SA'), 'GULF');
});

test('resolveCommercialMarket falls back to GLOBAL_OTHER for a country with no configured rule (data-driven fallback, not a hardcoded Gulf-country list)', async () => {
  const repo = new FakeMarketMappingRepository([{ countryCode: 'YE', commercialMarket: 'YEMEN' }]);
  assert.equal(await resolveCommercialMarket(repo, 'FR'), 'GLOBAL_OTHER');
  assert.equal(await resolveCommercialMarket(repo, null), 'GLOBAL_OTHER');
});

test('a new country->market rule can be added purely as configuration data without any source-code change to resolveCommercialMarket', async () => {
  const repo = new FakeMarketMappingRepository([]);
  assert.equal(await resolveCommercialMarket(repo, 'EG'), 'GLOBAL_OTHER');
  repo.rules.set('EG', 'GULF');
  assert.equal(await resolveCommercialMarket(repo, 'EG'), 'GULF');
});
