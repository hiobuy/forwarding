/**
 * Phase 2 boundary. React never calls HIOBuy.
 * Credentials stay in Worker secrets and are not read in Phase 1.
 */
export type HioBuyClient = {
  readonly configured: boolean;
};

export function createHioBuyClient(): HioBuyClient {
  return { configured: false };
}
