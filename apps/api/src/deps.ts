import type { Pool } from 'pg';
import type { AppConfig } from '@crypto-signal/shared';

export interface ApiDeps {
  pool: Pool;
  config: AppConfig;
}
