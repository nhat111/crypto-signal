export type HealthStatus = 'VERY_HEALTHY' | 'HEALTHY' | 'NEUTRAL' | 'WEAK' | 'VERY_WEAK';

/** Spec §13 component names, each scored independently 0-100. */
export interface HealthComponents {
  spotConfirmation: number;
  futuresPositioning: number;
  openInterest: number;
  funding: number;
  liquidation: number;
  volume: number;
  priceStructure: number;
  divergence: number;
}

export interface HealthResult {
  score: number;
  status: HealthStatus;
  components: HealthComponents;
}

/** Our own component breakdown for Leverage Risk — see ASSUMPTIONS.md §7. */
export interface RiskComponents {
  fundingExtremity: number;
  oiVelocity: number;
  basisExtremity: number;
  liquidationAnomaly: number;
  volumeExtremity: number;
  crowding: number;
}

export interface RiskResult {
  score: number;
  components: RiskComponents;
}
