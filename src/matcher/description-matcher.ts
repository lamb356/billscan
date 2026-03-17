/**
 * Description-to-CPT/HCPCS code matcher.
 *
 * Many hospital bills and EOBs only show text descriptions like
 * "X-RAY LUMBAR SPINE 2 VW" instead of CPT codes. This module resolves
 * those descriptions to CPT/HCPCS codes using:
 *   1. A hardcoded dictionary of ~200 common billing descriptions
 *   2. Token-based fuzzy matching against the dictionary
 *   3. Database lookups against CLFS, ASP, and OPPS short_desc columns
 */

import { getDb } from '../db/connection.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DescriptionMatchResult {
  cptCode: string;
  confidence: number; // 0–1
  matchMethod: 'dictionary' | 'db_exact' | 'db_fuzzy';
  matchedDescription: string;
}

// ---------------------------------------------------------------------------
// Description → CPT dictionary
//
// Keys are lowercase, stripped of special characters and collapsed whitespace.
// Each entry maps one or more description variants to a single CPT/HCPCS code.
// ---------------------------------------------------------------------------

const DESCRIPTION_TO_CPT: Record<string, string> = {
  // ── ER visits (99281–99285) ──────────────────────────────────────────────
  'emergency dept visit level 1': '99281',
  'er visit level 1': '99281',
  'ed visit level 1': '99281',
  'emergency department visit level 1': '99281',
  'emergency room visit level 1': '99281',
  'emergency dept visit level 2': '99282',
  'er visit level 2': '99282',
  'ed visit level 2': '99282',
  'emergency department visit level 2': '99282',
  'emergency room visit level 2': '99282',
  'emergency dept visit level 3': '99283',
  'er visit level 3': '99283',
  'ed visit level 3': '99283',
  'emergency department visit level 3': '99283',
  'emergency room visit level 3': '99283',
  'emergency dept visit level 4': '99284',
  'er visit level 4': '99284',
  'ed visit level 4': '99284',
  'emergency department visit level 4': '99284',
  'emergency room visit level 4': '99284',
  'emergency dept visit level 5': '99285',
  'er visit level 5': '99285',
  'ed visit level 5': '99285',
  'emergency department visit level 5': '99285',
  'emergency room visit level 5': '99285',
  'er visit high complexity': '99285',
  'ed visit high complexity': '99285',
  'emergency visit level 5': '99285',
  'emergency visit high severity': '99285',

  // ── Office visits – established patient (99211–99215) ────────────────────
  'office visit established level 1': '99211',
  'office visit est level 1': '99211',
  'office visit est pt level 1': '99211',
  'office visit established level 2': '99212',
  'office visit est level 2': '99212',
  'office visit est pt level 2': '99212',
  'office visit established level 3': '99213',
  'office visit est level 3': '99213',
  'office visit est pt level 3': '99213',
  'office outpt visit est': '99213',
  'office visit established level 4': '99214',
  'office visit est level 4': '99214',
  'office visit est pt level 4': '99214',
  'office outpt visit est lvl 4': '99214',
  'office visit established level 5': '99215',
  'office visit est level 5': '99215',
  'office visit est pt level 5': '99215',

  // ── Office visits – new patient (99201–99205) ────────────────────────────
  'office visit new level 1': '99201',
  'office visit new pt level 1': '99201',
  'office visit new level 2': '99202',
  'office visit new pt level 2': '99202',
  'new patient office visit level 2': '99202',
  'office visit new level 3': '99203',
  'office visit new pt level 3': '99203',
  'new patient office visit level 3': '99203',
  'office visit new level 4': '99204',
  'office visit new pt level 4': '99204',
  'new patient office visit level 4': '99204',
  'office visit new level 5': '99205',
  'office visit new pt level 5': '99205',
  'new patient office visit level 5': '99205',

  // ── Critical care (99291–99292) ──────────────────────────────────────────
  'critical care first hour': '99291',
  'critical care first 30 74 min': '99291',
  'critical care initial': '99291',
  'critical care 30 74 min': '99291',
  'critical care each addl 30 min': '99292',
  'critical care additional 30 min': '99292',
  'critical care addl 30 min': '99292',

  // ── Chest x-ray (71045–71048) ────────────────────────────────────────────
  'x ray chest 1 view': '71045',
  'xray chest 1 view': '71045',
  'chest x ray 1 view': '71045',
  'chest xray single view': '71045',
  'chest x ray 1 vw': '71045',
  'x ray chest 2 views': '71046',
  'xray chest 2 views': '71046',
  'chest x ray 2 views': '71046',
  'chest xray 2 views': '71046',
  'chest x ray 2 vw': '71046',
  'chest x ray pa and lateral': '71046',
  'chest xray pa lat': '71046',
  'x ray chest 3 views': '71047',
  'chest x ray 3 views': '71047',
  'x ray chest 4 views': '71048',
  'chest x ray 4 views': '71048',
  'chest x ray complete': '71048',

  // ── Lumbar spine x-ray (72100–72114) ─────────────────────────────────────
  'x ray lumbar spine 2 vw': '72100',
  'x ray lumbar spine 2': '72100',
  'xray lumbar spine 2 views': '72100',
  'xray lumbar 2 view': '72100',
  'lumbar spine 2 vw': '72100',
  'lumbar spine xray 2v': '72100',
  'lumbar spine x ray 2 views': '72100',
  'x ray lumbar spine 3 vw': '72110',
  'xray lumbar spine 3 views': '72110',
  'lumbar spine 3 vw': '72110',
  'lumbar spine x ray 3 views': '72110',
  'x ray lumbar spine complete': '72110',
  'x ray lumbar spine bend min 4 vw': '72114',
  'lumbar spine x ray with bending': '72114',
  'lumbar spine complete with flex': '72114',

  // ── CT scans (70450–70553) ───────────────────────────────────────────────
  'ct head without contrast': '70450',
  'ct head wo contrast': '70450',
  'ct head brain wo contrast': '70450',
  'ct scan head without contrast': '70450',
  'ct head w contrast': '70460',
  'ct head with contrast': '70460',
  'ct head wo and w contrast': '70470',
  'ct head without and with contrast': '70470',
  'ct chest without contrast': '71250',
  'ct chest wo contrast': '71250',
  'ct thorax wo contrast': '71250',
  'ct chest w contrast': '71260',
  'ct chest with contrast': '71260',
  'ct chest wo and w contrast': '71270',
  'ct chest without and with contrast': '71270',
  'ct abdomen without contrast': '74150',
  'ct abdomen wo contrast': '74150',
  'ct abd wo contrast': '74150',
  'ct abdomen w contrast': '74160',
  'ct abdomen with contrast': '74160',
  'ct abdomen wo and w contrast': '74170',
  'ct abdomen without and with contrast': '74170',
  'ct abdomen pelvis wo contrast': '74176',
  'ct abd pelvis without contrast': '74176',
  'ct abdomen pelvis w contrast': '74177',
  'ct abd pelvis with contrast': '74177',
  'ct abdomen pelvis wo and w contrast': '74178',
  'ct abd pelvis without and with contrast': '74178',

  // ── MRI (70551–73723) ───────────────────────────────────────────────────
  'mri brain without contrast': '70551',
  'mri brain wo contrast': '70551',
  'mri head wo contrast': '70551',
  'mri brain w contrast': '70552',
  'mri brain with contrast': '70552',
  'mri brain wo and w contrast': '70553',
  'mri brain without and with contrast': '70553',
  'mri cervical spine wo contrast': '72141',
  'mri c spine without contrast': '72141',
  'mri cervical spine w contrast': '72142',
  'mri cervical spine wo and w contrast': '72156',
  'mri thoracic spine wo contrast': '72146',
  'mri t spine without contrast': '72146',
  'mri lumbar spine wo contrast': '72148',
  'mri l spine without contrast': '72148',
  'mri lumbar spine w contrast': '72149',
  'mri lumbar spine wo and w contrast': '72158',
  'mri knee without contrast': '73721',
  'mri knee wo contrast': '73721',
  'mri knee w contrast': '73722',
  'mri knee with contrast': '73722',
  'mri knee wo and w contrast': '73723',

  // ── Ultrasound (76700–76857) ─────────────────────────────────────────────
  'ultrasound abdomen complete': '76700',
  'us abdomen complete': '76700',
  'abdominal ultrasound complete': '76700',
  'ultrasound abdomen limited': '76705',
  'us abdomen limited': '76705',
  'ultrasound pelvis complete': '76856',
  'us pelvis complete': '76856',
  'pelvic ultrasound complete': '76856',
  'ultrasound pelvis limited': '76857',
  'us pelvis limited': '76857',
  'pelvic ultrasound limited': '76857',
  'ultrasound retroperitoneal': '76770',
  'us retroperitoneal complete': '76770',
  'ultrasound renal': '76770',

  // ── Lab: CBC (85025–85027) ───────────────────────────────────────────────
  'cbc with differential': '85025',
  'cbc w auto diff': '85025',
  'cbc automated differential': '85025',
  'complete blood count with diff': '85025',
  'complete blood count auto diff': '85025',
  'cbc automated': '85027',
  'cbc without differential': '85027',
  'cbc wo diff': '85027',
  'complete blood count': '85027',

  // ── Lab: CMP (80053) ─────────────────────────────────────────────────────
  'comprehensive metabolic panel': '80053',
  'cmp': '80053',
  'comp metabolic panel': '80053',
  'metabolic panel comprehensive': '80053',

  // ── Lab: BMP (80048) ─────────────────────────────────────────────────────
  'basic metabolic panel': '80048',
  'bmp': '80048',
  'metabolic panel basic': '80048',

  // ── Lab: Lipid panel (80061) ─────────────────────────────────────────────
  'lipid panel': '80061',
  'lipid profile': '80061',
  'cholesterol panel': '80061',

  // ── Lab: Urinalysis (81001–81003) ────────────────────────────────────────
  'urinalysis automated with micro': '81001',
  'ua with microscopy': '81001',
  'urinalysis w micro': '81001',
  'urinalysis auto wo micro': '81003',
  'urinalysis automated': '81003',
  'ua without microscopy': '81003',
  'urinalysis dipstick': '81002',
  'ua nonauto wo micro': '81002',

  // ── Lab: TSH (84443) ─────────────────────────────────────────────────────
  'tsh': '84443',
  'thyroid stimulating hormone': '84443',
  'tsh assay': '84443',

  // ── Lab: HbA1c (83036) ──────────────────────────────────────────────────
  'hemoglobin a1c': '83036',
  'hba1c': '83036',
  'glycosylated hemoglobin': '83036',
  'a1c': '83036',
  'glycated hemoglobin': '83036',

  // ── Lab: PSA (84153) ─────────────────────────────────────────────────────
  'psa': '84153',
  'prostate specific antigen': '84153',
  'psa total': '84153',

  // ── Lab: Blood glucose (82947) ───────────────────────────────────────────
  'blood glucose': '82947',
  'glucose quantitative': '82947',
  'glucose blood test': '82947',
  'glucose level': '82947',
  'blood sugar': '82947',

  // ── Blood draw / venipuncture (36415–36416) ──────────────────────────────
  'venipuncture': '36415',
  'blood draw': '36415',
  'routine venipuncture': '36415',
  'phlebotomy': '36415',
  'collection of venous blood': '36415',
  'venipuncture capillary': '36416',
  'capillary blood draw': '36416',
  'finger stick': '36416',

  // ── IV infusion/push (96365–96375) ───────────────────────────────────────
  'iv infusion initial up to 1 hr': '96365',
  'iv infusion first hour': '96365',
  'iv infusion initial': '96365',
  'iv infusion therapy 1st hr': '96365',
  'iv infusion each additional hour': '96366',
  'iv infusion addl hour': '96366',
  'iv infusion sequential up to 1 hr': '96367',
  'iv infusion concurrent': '96368',
  'iv push single drug': '96374',
  'iv push initial substance': '96374',
  'iv push single': '96374',
  'iv injection push': '96374',
  'iv push each additional': '96375',
  'iv push addl drug': '96375',
  'iv push additional sequential': '96375',
  'therapeutic prophylactic iv infusion': '96365',
  'hydration iv infusion initial': '96360',
  'hydration iv infusion first hr': '96360',
  'hydration iv first hour': '96360',
  'hydration iv infusion addl hour': '96361',
  'hydration iv each additional hour': '96361',

  // ── EKG/ECG (93000–93010) ────────────────────────────────────────────────
  'ekg complete': '93000',
  'ecg complete': '93000',
  'electrocardiogram complete': '93000',
  'ekg 12 lead': '93000',
  'ecg 12 lead': '93000',
  'electrocardiogram 12 lead': '93000',
  'ekg interpretation only': '93010',
  'ecg interpretation only': '93010',
  'ekg tracing only': '93005',
  'ecg tracing only': '93005',

  // ── Anesthesia / sedation (99152–99153) ──────────────────────────────────
  'moderate sedation initial 15 min': '99152',
  'conscious sedation first 15 min': '99152',
  'moderate sedation same physician': '99152',
  'sedation initial': '99152',
  'moderate sedation each addl 15 min': '99153',
  'conscious sedation addl 15 min': '99153',
  'moderate sedation additional': '99153',

  // ── Wound repair (12001–13160) ───────────────────────────────────────────
  'repair superficial wound simple': '12001',
  'simple repair scalp neck trunk 2.5cm or less': '12001',
  'simple wound repair 2.5cm or less': '12001',
  'wound repair simple face 2.5cm or less': '12011',
  'simple repair face 2.5cm or less': '12011',
  'wound repair simple scalp 2.6 to 7.5cm': '12002',
  'simple repair 2.6 7.5 cm': '12002',
  'wound repair simple 7.6 to 12.5cm': '12004',
  'simple repair 7.6 12.5 cm': '12004',
  'wound repair intermediate': '12031',
  'intermediate repair scalp 2.5cm or less': '12031',
  'intermediate wound repair 2.5cm or less': '12031',
  'intermediate repair 2.6 7.5cm': '12032',
  'wound repair complex': '13100',
  'complex repair trunk 1.1 to 2.5cm': '13100',
  'complex wound repair': '13100',
  'complex repair face 1.1 to 2.5cm': '13131',
  'complex repair scalp 1.1 to 2.5cm': '13120',
  'complex repair forearm 1.1 to 2.5cm': '13150',
  'complex repair eyelid 1cm or less': '13160',

  // ── Drug J-codes (common ER drugs) ───────────────────────────────────────
  'dexamethasone sodium phosphate': 'J1100',
  'dexamethasone injection': 'J1100',
  'dexamethasone 1mg': 'J1100',
  'ondansetron injection': 'J2405',
  'zofran injection': 'J2405',
  'ondansetron 1mg': 'J2405',
  'unclassified drug': 'J3490',
  'drugs unclassified injection': 'J3490',
  'morphine sulfate injection': 'J2270',
  'morphine injection': 'J2270',
  'morphine sulfate 10mg': 'J2270',
  'ketorolac tromethamine injection': 'J1885',
  'toradol injection': 'J1885',
  'ketorolac 15mg': 'J1885',
  'diphenhydramine injection': 'J1200',
  'benadryl injection': 'J1200',
  'diphenhydramine 50mg': 'J1200',
  'metoclopramide injection': 'J2765',
  'reglan injection': 'J2765',
  'promethazine injection': 'J2550',
  'phenergan injection': 'J2550',
  'lorazepam injection': 'J2060',
  'ativan injection': 'J2060',
  'methylprednisolone injection': 'J2310',
  'depo medrol injection': 'J2310',
  'solu medrol injection': 'J2930',
  'methylprednisolone 125mg': 'J2930',
  'acetaminophen injection': 'J0131',
  'ofirmev injection': 'J0131',
  'iv acetaminophen': 'J0131',
  'normal saline infusion': 'J7050',
  'sodium chloride 0.9 infusion': 'J7050',
  'ns infusion 250ml': 'J7050',
  'lactated ringers infusion': 'J7120',
  'lr infusion': 'J7120',
  'epinephrine injection': 'J0171',
  'epi injection': 'J0171',
  'ceftriaxone injection': 'J0696',
  'rocephin injection': 'J0696',
  'cefazolin injection': 'J0690',
  'ancef injection': 'J0690',
  'pantoprazole injection': 'C9113',
  'protonix injection': 'C9113',
  'famotidine injection': 'J1640',

  // ── Physical therapy (97110, 97140, 97161–97163) ─────────────────────────
  'pt eval low complexity': '97161',
  'physical therapy eval low complexity': '97161',
  'physical therapy evaluation low': '97161',
  'pt evaluation low': '97161',
  'pt eval moderate complexity': '97162',
  'physical therapy eval moderate': '97162',
  'physical therapy evaluation moderate': '97162',
  'pt evaluation moderate': '97162',
  'pt eval high complexity': '97163',
  'physical therapy eval high complexity': '97163',
  'physical therapy evaluation high': '97163',
  'pt evaluation high': '97163',
  'therapeutic exercise': '97110',
  'therapeutic exercises': '97110',
  'therapeutic exercise 15 min': '97110',
  'exercise therapy 15 min': '97110',
  'manual therapy': '97140',
  'manual therapy techniques': '97140',
  'manual therapy 15 min': '97140',
  'neuromuscular reeducation': '97112',
  'neuromuscular re education': '97112',
  'therapeutic activities': '97530',
  'therapeutic activity 15 min': '97530',
  'gait training': '97116',
  'gait training therapy': '97116',

  // ── Immunizations (90460, 90471–90472, common vaccines) ──────────────────
  'immunization admin first component': '90460',
  'immunization admin child first': '90460',
  'vaccine admin first': '90460',
  'immunization admin each addl component': '90461',
  'immunization admin adult first': '90471',
  'immunization admin 1st vaccine': '90471',
  'vaccine administration first': '90471',
  'immunization admin each addl': '90472',
  'immunization admin addl vaccine': '90472',
  'vaccine administration additional': '90472',
  'flu vaccine': '90686',
  'influenza vaccine': '90686',
  'influenza virus vaccine': '90686',
  'flu shot': '90686',
  'tdap vaccine': '90715',
  'tetanus diphtheria pertussis': '90715',
  'td vaccine': '90714',
  'tetanus diphtheria vaccine': '90714',
  'pneumococcal vaccine': '90670',
  'prevnar vaccine': '90670',
  'pneumovax vaccine': '90732',
  'hepatitis b vaccine adult': '90746',
  'hep b vaccine 3 dose': '90746',
  'hepatitis a vaccine adult': '90632',
  'hep a vaccine': '90632',
  'mmr vaccine': '90707',
  'measles mumps rubella vaccine': '90707',
  'varicella vaccine': '90716',
  'chickenpox vaccine': '90716',
  'shingles vaccine': '90750',
  'zoster vaccine recombinant': '90750',
  'shingrix vaccine': '90750',
  'covid 19 vaccine': '91309',
  'covid vaccine': '91309',
  'hpv vaccine': '90651',
  'gardasil vaccine': '90651',

  // ── Observation / hospital care ──────────────────────────────────────────
  'observation care initial': '99218',
  'initial observation care low': '99218',
  'observation care initial moderate': '99219',
  'observation care initial high': '99220',
  'observation care discharge': '99217',
  'hospital admission initial low': '99221',
  'initial hospital care low': '99221',
  'hospital admission moderate': '99222',
  'initial hospital care moderate': '99222',
  'hospital admission high': '99223',
  'initial hospital care high': '99223',
  'hospital discharge day 30 min or less': '99238',
  'hospital discharge': '99238',
  'hospital discharge day management': '99238',
  'hospital discharge more than 30 min': '99239',

  // ── Additional common procedures ─────────────────────────────────────────
  'pulse oximetry': '94760',
  'pulse ox': '94760',
  'nebulizer treatment': '94640',
  'nebulizer therapy': '94640',
  'inhalation treatment': '94640',
  'breathing treatment': '94640',
  'splint application': '29105',
  'splint long arm': '29105',
  'splint short arm': '29125',
  'splint finger': '29130',
  'urine drug screen': '80305',
  'drug screen urine': '80305',
  'urine drug test': '80305',
  'blood type and screen': '86900',
  'blood typing abo': '86900',
  'blood type abo': '86900',
  'rh typing': '86901',
  'blood type rh': '86901',
  'prothrombin time': '85610',
  'pt inr': '85610',
  'protime': '85610',
  'partial thromboplastin time': '85730',
  'ptt': '85730',
  'troponin': '84484',
  'troponin quantitative': '84484',
  'troponin i': '84484',
  'lactic acid': '83605',
  'lactate level': '83605',
  'blood culture': '87040',
  'aerobic blood culture': '87040',
  'ct angiography chest': '71275',
  'cta chest': '71275',
  'ct angiography head': '70496',
  'cta head': '70496',
  'ct angiography abdomen': '74175',
  'cta abdomen': '74175',
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a description for matching: lowercase, strip non-alphanumeric
 * characters (except spaces), and collapse whitespace.
 */
function normalize(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a normalized string into deduplicated tokens. */
function tokenize(s: string): string[] {
  return [...new Set(s.split(' ').filter(t => t.length > 0))];
}

// ---------------------------------------------------------------------------
// Token overlap scoring
// ---------------------------------------------------------------------------

/**
 * Compute a symmetric token-overlap score between two token arrays.
 * Returns a value in [0, 1] representing how well the tokens match,
 * accounting for word-order-independent matching.
 */
function tokenOverlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const matches = a.filter(t => setB.has(t)).length;
  // Use the smaller set as the denominator so that a short query
  // like "lumbar spine xray" can fully match a longer dictionary key.
  const denominator = Math.min(a.length, b.length);
  return matches / denominator;
}

// Pre-tokenize dictionary keys for fast fuzzy lookup.
const DICTIONARY_ENTRIES: Array<{ key: string; tokens: string[]; code: string }> =
  Object.entries(DESCRIPTION_TO_CPT).map(([key, code]) => ({
    key,
    tokens: tokenize(key),
    code,
  }));

// ---------------------------------------------------------------------------
// Dictionary matching
// ---------------------------------------------------------------------------

function matchDictionaryExact(normalized: string): DescriptionMatchResult | null {
  const code = DESCRIPTION_TO_CPT[normalized];
  if (code) {
    return {
      cptCode: code,
      confidence: 1.0,
      matchMethod: 'dictionary',
      matchedDescription: normalized,
    };
  }
  return null;
}

function matchDictionaryFuzzy(normalized: string): DescriptionMatchResult | null {
  const inputTokens = tokenize(normalized);
  if (inputTokens.length === 0) return null;

  let bestScore = 0;
  let bestEntry: (typeof DICTIONARY_ENTRIES)[number] | null = null;

  for (const entry of DICTIONARY_ENTRIES) {
    const score = tokenOverlapScore(inputTokens, entry.tokens);
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  if (bestScore >= 0.7 && bestEntry) {
    return {
      cptCode: bestEntry.code,
      confidence: Math.round(bestScore * 100) / 100,
      matchMethod: 'dictionary',
      matchedDescription: bestEntry.key,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Database matching
// ---------------------------------------------------------------------------

/**
 * Search CLFS, ASP, and OPPS tables for descriptions matching the input.
 * Tries exact LIKE match first, then a broader fuzzy LIKE with leading tokens.
 */
async function matchFromDatabase(normalized: string): Promise<DescriptionMatchResult | null> {
  const db = getDb();
  const tokens = tokenize(normalized);
  if (tokens.length === 0) return null;

  // Build a LIKE pattern from the first few significant tokens
  const likePattern = `%${normalized}%`;

  // Try exact substring match across all three tables
  const tables: Array<{ table: string; descCol: string }> = [
    { table: 'clfs_rates', descCol: 'short_desc' },
    { table: 'clfs_rates', descCol: 'long_desc' },
    { table: 'asp_rates', descCol: 'short_desc' },
    { table: 'opps_rates', descCol: 'short_desc' },
  ];

  for (const { table, descCol } of tables) {
    try {
      const result = await db.execute({
        sql: `SELECT hcpcs_code, ${descCol} AS matched_desc FROM ${table} WHERE LOWER(${descCol}) LIKE ? LIMIT 1`,
        args: [likePattern],
      });
      if (result.rows.length > 0) {
        const row = result.rows[0] as unknown as { hcpcs_code: string; matched_desc: string };
        return {
          cptCode: row.hcpcs_code,
          confidence: 0.85,
          matchMethod: 'db_exact',
          matchedDescription: row.matched_desc,
        };
      }
    } catch {
      // Table may not exist in dev — skip silently
    }
  }

  // Fuzzy: use first 2 significant tokens (words > 2 chars) in a LIKE query
  const significantTokens = tokens.filter(t => t.length > 2).slice(0, 2);
  if (significantTokens.length === 0) return null;

  for (const { table, descCol } of tables) {
    try {
      // Build WHERE clause: LOWER(col) LIKE '%token1%' AND LOWER(col) LIKE '%token2%'
      const conditions = significantTokens.map((_, i) => `LOWER(${descCol}) LIKE ?`);
      const args = significantTokens.map(t => `%${t}%`);

      const result = await db.execute({
        sql: `SELECT hcpcs_code, ${descCol} AS matched_desc FROM ${table} WHERE ${conditions.join(' AND ')} LIMIT 5`,
        args,
      });

      if (result.rows.length > 0) {
        // Score each result by token overlap and pick the best
        let bestRow: { hcpcs_code: string; matched_desc: string } | null = null;
        let bestScore = 0;

        for (const row of result.rows as unknown as Array<{ hcpcs_code: string; matched_desc: string }>) {
          const rowTokens = tokenize(normalize(row.matched_desc));
          const score = tokenOverlapScore(tokens, rowTokens);
          if (score > bestScore) {
            bestScore = score;
            bestRow = row;
          }
        }

        if (bestRow && bestScore >= 0.5) {
          return {
            cptCode: bestRow.hcpcs_code,
            confidence: Math.round(Math.min(bestScore * 0.9, 0.8) * 100) / 100,
            matchMethod: 'db_fuzzy',
            matchedDescription: bestRow.matched_desc,
          };
        }
      }
    } catch {
      // Table may not exist — skip
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main matching function
// ---------------------------------------------------------------------------

/**
 * Attempt to resolve a medical procedure description to a CPT/HCPCS code.
 *
 * Matching strategy (in order):
 *  1. Exact dictionary match (confidence = 1.0)
 *  2. Fuzzy dictionary match via token overlap ≥70% (confidence = overlap score)
 *  3. DB lookup — exact substring in CLFS/ASP/OPPS short_desc (confidence = 0.85)
 *  4. DB lookup — fuzzy multi-token search (confidence ≤ 0.80)
 *  5. Return null if nothing above 0.6 confidence
 *
 * @param description - Raw procedure description from a bill (e.g. "X-RAY LUMBAR SPINE 2 VW")
 * @returns Match result with CPT code and confidence, or null
 */
export async function matchDescriptionToCpt(
  description: string,
): Promise<DescriptionMatchResult | null> {
  const normalized = normalize(description);
  if (normalized.length < 2) return null;

  // 1. Exact dictionary match
  const exact = matchDictionaryExact(normalized);
  if (exact) return exact;

  // 2. Fuzzy dictionary match (token overlap ≥ 70%)
  const fuzzy = matchDictionaryFuzzy(normalized);
  if (fuzzy && fuzzy.confidence >= 0.7) return fuzzy;

  // 3 & 4. Database lookups
  const dbResult = await matchFromDatabase(normalized);
  if (dbResult && dbResult.confidence >= 0.6) return dbResult;

  // 5. Nothing met the confidence threshold
  return null;
}
