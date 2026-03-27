/**
 * Insurance Cost Estimator API Stubs
 *
 * These functions will be implemented when API access is obtained
 * from respective insurers. Currently returns null for all.
 */

export interface InsuranceCostEstimate {
  insurer: string;
  cptCode: string;
  estimatedCost: number | null;
  inNetwork: boolean;
  source: string;
  disclaimer: string;
}

const DISCLAIMER = 'This is an estimate only. Actual costs may vary based on your specific plan, deductible, and network status. Contact your insurer for exact costs.';

/**
 * UnitedHealthcare Cost Estimator
 * Requires partnership agreement for API access
 */
export async function getUHCEstimate(
  _cptCode: string,
  _zip: string,
): Promise<InsuranceCostEstimate | null> {
  // UHC Cost Estimator API — requires partnership agreement
  return null;
}

/**
 * Anthem / Elevance Health Estimate
 */
export async function getAnthemEstimate(
  _cptCode: string,
  _zip: string,
): Promise<InsuranceCostEstimate | null> {
  return null;
}

/**
 * Aetna / CVS Health Estimate
 */
export async function getAetnaEstimate(
  _cptCode: string,
  _zip: string,
): Promise<InsuranceCostEstimate | null> {
  return null;
}

/**
 * Cigna Estimate
 */
export async function getCignaEstimate(
  _cptCode: string,
  _zip: string,
): Promise<InsuranceCostEstimate | null> {
  return null;
}

/**
 * Humana Estimate
 */
export async function getHumanaEstimate(
  _cptCode: string,
  _zip: string,
): Promise<InsuranceCostEstimate | null> {
  return null;
}

/**
 * Query all available insurance estimators and return any available data.
 */
export async function getAllEstimates(
  cptCode: string,
  zip: string,
): Promise<InsuranceCostEstimate[]> {
  const fetchers = [
    getUHCEstimate(cptCode, zip),
    getAnthemEstimate(cptCode, zip),
    getAetnaEstimate(cptCode, zip),
    getCignaEstimate(cptCode, zip),
    getHumanaEstimate(cptCode, zip),
  ];

  const results = await Promise.all(fetchers);
  return results.filter((r): r is InsuranceCostEstimate => r !== null);
}
