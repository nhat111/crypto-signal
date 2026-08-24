import type { Pool } from 'pg';
import type { AppConfig } from '@crypto-signal/shared';
import type { GemConfig } from '@crypto-signal/gem-scanner';

export interface ApiDeps {
  pool: Pool;
  config: AppConfig;
  /** Null when the gem scanner is disabled — watches need its thresholds/enabled flag, same as the worker. */
  gemConfig: GemConfig | null;
}
