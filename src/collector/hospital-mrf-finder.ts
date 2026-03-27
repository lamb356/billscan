/**
 * Hospital MRF (Machine-Readable File) Finder
 *
 * Fuzzy-matches hospital names against a curated list of hospital systems
 * and their published price transparency MRF URLs.
 *
 * Data source: data/hospital-mrf-urls.json (manually curated)
 * CMS requirement: CMS-1717-F2 (Hospital Price Transparency Rule)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HospitalMrfEntry {
  name: string;
  aliases: string[];
  mrf_url: string;
  type: string;
  states: string[];
}

export interface MrfMatch {
  hospitalName: string;
  mrfUrl: string;
  type: string;
  states: string[];
  score: number;
  matchedOn: string; // which name/alias matched
}

// ─── Data loading ────────────────────────────────────────────────────────────

let cachedEntries: HospitalMrfEntry[] | null = null;

function loadMrfData(): HospitalMrfEntry[] {
  if (cachedEntries) return cachedEntries;

  const dataPath = resolve(process.cwd(), 'data', 'hospital-mrf-urls.json');
  const raw = readFileSync(dataPath, 'utf-8');
  const parsed = JSON.parse(raw);
  cachedEntries = parsed.hospitals as HospitalMrfEntry[];
  return cachedEntries;
}

// ─── Fuzzy matching ──────────────────────────────────────────────────────────

/**
 * Normalizes a hospital name for comparison:
 * - lowercase
 * - strip common suffixes (hospital, medical center, health system, etc.)
 * - strip punctuation
 * - collapse whitespace
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/\b(hospital|medical center|health system|health care|healthcare|health|regional|community|memorial|university|the)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenizes a string into words for comparison.
 */
function tokenize(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean);
}

/**
 * Computes a similarity score between two strings using token overlap.
 * Returns a number between 0 and 1 (1 = perfect match).
 */
function tokenSimilarity(query: string, target: string): number {
  const queryTokens = tokenize(query);
  const targetTokens = tokenize(target);

  if (queryTokens.length === 0 || targetTokens.length === 0) return 0;

  // Check for exact normalized match first
  const normQ = normalize(query);
  const normT = normalize(target);
  if (normQ === normT) return 1.0;

  // Check if one contains the other
  if (normQ.includes(normT) || normT.includes(normQ)) return 0.9;

  // Token overlap (Jaccard-like, weighted toward query coverage)
  let matches = 0;
  for (const qt of queryTokens) {
    for (const tt of targetTokens) {
      if (qt === tt) { matches++; break; }
      // Partial token match (prefix)
      if (qt.length >= 3 && tt.startsWith(qt)) { matches += 0.8; break; }
      if (tt.length >= 3 && qt.startsWith(tt)) { matches += 0.8; break; }
    }
  }

  // Score is coverage of query tokens, with bonus for target coverage
  const queryCoverage = matches / queryTokens.length;
  const targetCoverage = matches / targetTokens.length;
  return queryCoverage * 0.7 + targetCoverage * 0.3;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Find hospital MRF URLs matching a hospital name.
 * Returns matches sorted by score (best first), filtered to score >= threshold.
 *
 * @param hospitalName  The hospital name to search for
 * @param options.state Optional state filter (2-letter code)
 * @param options.threshold Minimum match score (default 0.3)
 * @param options.limit Maximum results to return (default 5)
 */
export function findHospitalMRF(
  hospitalName: string,
  options?: {
    state?: string;
    threshold?: number;
    limit?: number;
  },
): MrfMatch[] {
  const entries = loadMrfData();
  const threshold = options?.threshold ?? 0.3;
  const limit = options?.limit ?? 5;
  const stateFilter = options?.state?.toUpperCase();

  const results: MrfMatch[] = [];

  for (const entry of entries) {
    // Optionally filter by state
    if (stateFilter && !entry.states.includes(stateFilter)) continue;

    // Score against primary name and all aliases
    let bestScore = 0;
    let bestMatchedOn = entry.name;

    const candidates = [entry.name, ...entry.aliases];
    for (const candidate of candidates) {
      const score = tokenSimilarity(hospitalName, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestMatchedOn = candidate;
      }
    }

    if (bestScore >= threshold) {
      results.push({
        hospitalName: entry.name,
        mrfUrl: entry.mrf_url,
        type: entry.type,
        states: entry.states,
        score: +bestScore.toFixed(3),
        matchedOn: bestMatchedOn,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

/**
 * Get all known hospital MRF entries (for listing/browsing).
 */
export function listHospitalMRFs(): HospitalMrfEntry[] {
  return loadMrfData();
}

/**
 * Auto-fetch hospital prices by name.
 * Finds the best-matching MRF URL and attempts to download + parse it.
 * Returns the MRF URL and metadata if a match is found (actual parsing
 * happens via the hospital-price-parser + hospital-price-importer pipeline).
 */
export async function autoFetchHospitalPrices(
  hospitalName: string,
  options?: { state?: string },
): Promise<{ found: boolean; mrfUrl?: string; hospitalName?: string; score?: number } | null> {
  const matches = findHospitalMRF(hospitalName, {
    state: options?.state,
    threshold: 0.4,
    limit: 1,
  });

  if (matches.length === 0) {
    return { found: false };
  }

  const best = matches[0];
  return {
    found: true,
    mrfUrl: best.mrfUrl,
    hospitalName: best.hospitalName,
    score: best.score,
  };
}
