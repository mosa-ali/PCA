/**
 * PCA Billing Core -- CommercialMarket (`PCA-ADD-BILL-045`).
 *
 * Three markets: YEMEN, GULF, GLOBAL_OTHER (the catch-all default),
 * mirroring migrations/0007_billing_core.sql's `billing_commercial_markets`
 * seed rows. Each carries a default charge currency
 * (`PCA-ADD-BILL-019`: YEMEN->YER, GULF->SAR, GLOBAL/OTHER->USD) -- this
 * mapping is a fixed architectural rule from the addendum itself, not a
 * user-configurable setting, so it is a plain reused constant here (never
 * re-derived per call site).
 *
 * Country/region -> market ASSIGNMENT, by contrast, is explicitly required
 * to be data/config-driven (mission constraint 3) -- see
 * MarketMappingRepository/MySqlMarketMappingService below, backed by
 * `billing_country_market_rules`, never a hardcoded permanent Gulf-country
 * list in this file.
 */

import type { PoolConnection } from 'mysql2/promise';
import { execute, runInTransaction } from '../db/pool.js';
import type { CurrencyCode } from './currency.js';

export const COMMERCIAL_MARKETS = ['YEMEN', 'GULF', 'GLOBAL_OTHER'] as const;
export type CommercialMarket = (typeof COMMERCIAL_MARKETS)[number];

export function isCommercialMarket(value: string): value is CommercialMarket {
  return (COMMERCIAL_MARKETS as readonly string[]).includes(value);
}

/** `PCA-ADD-BILL-019`'s market -> default-charge-currency mapping, transcribed verbatim. */
export const MARKET_DEFAULT_CURRENCY: Readonly<Record<CommercialMarket, CurrencyCode>> = {
  YEMEN: 'YER',
  GULF: 'SAR',
  GLOBAL_OTHER: 'USD',
};

interface CountryMarketRuleRow {
  country_code: string;
  commercial_market: string;
}

/**
 * Persistence port for the configurable country -> CommercialMarket
 * assignment-rule table (`billing_country_market_rules`). Suitable for a
 * later Platform Administration settings surface to administer directly --
 * this interface intentionally exposes only read + upsert, no in-code
 * per-country branching logic.
 */
export interface MarketMappingRepository {
  resolveMarketForCountry(countryCode: string): Promise<CommercialMarket | null>;
  listRules(): Promise<Array<{ countryCode: string; commercialMarket: CommercialMarket }>>;
  upsertRule(conn: PoolConnection, countryCode: string, commercialMarket: CommercialMarket): Promise<void>;
}

export class MySqlMarketMappingRepository implements MarketMappingRepository {
  async resolveMarketForCountry(countryCode: string): Promise<CommercialMarket | null> {
    const normalized = countryCode.toUpperCase();
    const { rows } = await runInTransaction((conn) =>
      execute<CountryMarketRuleRow>(conn, `SELECT country_code, commercial_market FROM billing_country_market_rules WHERE country_code = ?`, [normalized]),
    );
    return rows[0] ? (rows[0].commercial_market as CommercialMarket) : null;
  }

  async listRules(): Promise<Array<{ countryCode: string; commercialMarket: CommercialMarket }>> {
    const { rows } = await runInTransaction((conn) =>
      execute<CountryMarketRuleRow>(conn, `SELECT country_code, commercial_market FROM billing_country_market_rules ORDER BY country_code`, []),
    );
    return rows.map((row) => ({ countryCode: row.country_code, commercialMarket: row.commercial_market as CommercialMarket }));
  }

  async upsertRule(conn: PoolConnection, countryCode: string, commercialMarket: CommercialMarket): Promise<void> {
    const normalized = countryCode.toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) throw new Error(`Invalid ISO 3166-1 alpha-2 country code: ${countryCode}`);
    await execute(
      conn,
      `INSERT INTO billing_country_market_rules (country_code, commercial_market) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE commercial_market = VALUES(commercial_market)`,
      [normalized, commercialMarket],
    );
  }
}

/**
 * Resolves a registration country/region to its CommercialMarket via the
 * configurable rule table, falling back to GLOBAL_OTHER (the catch-all
 * default per `PCA-ADD-BILL-045`) when no rule row exists for the country --
 * the fallback itself is data-driven behavior (absence of a row), never an
 * application-code Gulf-country enumeration.
 */
export async function resolveCommercialMarket(
  repository: MarketMappingRepository,
  countryCode: string | null,
): Promise<CommercialMarket> {
  if (!countryCode) return 'GLOBAL_OTHER';
  const resolved = await repository.resolveMarketForCountry(countryCode);
  return resolved ?? 'GLOBAL_OTHER';
}
