/**
 * Field comparison — the deterministic decision layer.
 *
 * Design reference: §6.1 (the model reads, the rules compare), §8.4.3.
 *
 * Pure: no I/O, no clock, no model, no network. Given the same extraction and
 * the same application data, the verdicts are identical forever — which is what
 * makes NFR-13 replayability achievable and lets the suite run offline at zero
 * cost.
 *
 * Every verdict names the rule that produced it. An agent must be able to see
 * *why* a finding was made, not merely that it was (FR-10, and Dave's objection
 * — SRC-4).
 */

import { normalizeText, textEquivalent } from './normalize.js'
import { CONVERSION_TOLERANCE, parseAbv, parseQuantity } from './parse.js'
import type {
  ApplicationData,
  Extraction,
  FieldName,
  FieldVerdict,
  ObservedField,
} from './types.js'
import { FIELDS } from './types.js'

/** Below this, a reading is surfaced for confirmation rather than trusted silently. */
export const LOW_CONFIDENCE_THRESHOLD = 0.7

/** Which comparison rule each field uses (§8.4.3). */
const FIELD_RULE: Record<FieldName, 'tolerant-text' | 'numeric' | 'quantity'> = {
  brandName: 'tolerant-text',
  classType: 'tolerant-text',
  alcoholContent: 'numeric',
  netContents: 'quantity',
}

/**
 * Cases that do not depend on the field's rule.
 *
 * Order matters and is asserted by test: nothing supplied is "not assessed",
 * not a failure; an unreadable field is never downgraded to a mismatch (FR-11).
 */
function preCompare(
  field: FieldName,
  expected: string | null,
  observed: ObservedField,
): FieldVerdict | null {
  const expectedTrimmed = expected?.trim() ?? ''

  if (expectedTrimmed === '') {
    return {
      field,
      state: 'NOT_SUPPLIED',
      expected: null,
      observed: observed.raw,
      rule: 'Not assessed — the application did not supply this field',
    }
  }

  // Checked before emptiness: an extractor may return a low-quality guess
  // alongside the unreadable flag, and a guess must never become a discrepancy.
  if (observed.unreadable) {
    return {
      field,
      state: 'UNREADABLE',
      expected: expectedTrimmed,
      observed: null,
      rule: 'Could not be read from the image',
      explanation: 'This part of the image is unclear. A clearer photo is needed.',
    }
  }

  const raw = observed.raw?.trim() ?? ''
  if (raw === '') {
    return {
      field,
      state: 'MISSING_ON_LABEL',
      expected: expectedTrimmed,
      observed: null,
      rule: 'Not found on the label',
    }
  }

  return null
}

/** Flag a low-confidence match. A mismatch is reported as a mismatch regardless. */
function applyConfidence(verdict: FieldVerdict, confidence: number): FieldVerdict {
  if (verdict.state !== 'MATCH' || confidence >= LOW_CONFIDENCE_THRESHOLD) return verdict
  return {
    ...verdict,
    state: 'LOW_CONFIDENCE',
    explanation: 'Please double-check this one — the label was hard to read here.',
  }
}

/** Name the difference that was tolerated, so the agent sees the rule was applied deliberately. */
function describeTextDifference(expected: string, observed: string): string {
  if (expected.toLowerCase() === observed.toLowerCase()) {
    return 'Capitalisation differs — treated as a match.'
  }
  const differences: string[] = []
  if (expected.replace(/\s+/g, '') !== observed.replace(/\s+/g, '')) differences.push('spacing')
  if (expected.toLowerCase() !== observed.toLowerCase()) differences.push('capitalisation')
  differences.push('punctuation')
  const list = [...new Set(differences)].join(' and ')
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} differ — treated as a match.`
}

function compareTolerantText(field: FieldName, expected: string, observed: string): FieldVerdict {
  if (expected === observed) {
    // Exact match: no rule was exercised, so no explanation (ui-design §6.3).
    return { field, state: 'MATCH', expected, observed, rule: 'Exact match' }
  }

  if (textEquivalent(expected, observed)) {
    return {
      field,
      state: 'MATCH',
      expected,
      observed,
      rule: 'Matches after ignoring capitalisation, punctuation and spacing',
      explanation: describeTextDifference(expected, observed),
    }
  }

  return {
    field,
    state: 'MISMATCH',
    expected,
    observed,
    rule: 'Compared ignoring capitalisation, punctuation and spacing',
  }
}

function compareNumeric(field: FieldName, expected: string, observed: string): FieldVerdict {
  const expectedAbv = parseAbv(expected)
  const observedAbv = parseAbv(observed)

  if (observedAbv === null) {
    return {
      field,
      state: 'UNREADABLE',
      expected,
      observed,
      rule: 'No alcohol content could be read from this text',
      explanation: 'The label text did not contain a recognisable percentage or proof.',
    }
  }

  if (expectedAbv === null) {
    return {
      field,
      state: 'MISMATCH',
      expected,
      observed,
      rule: 'The application value could not be read as a number',
    }
  }

  // Exact comparison. Q7 resolved: 27 CFR 5.65 and 5.37 govern actual contents
  // against the label, not the label against the application — two statements
  // of the same intended figure have nothing to vary (project-reference §8.5).
  if (expectedAbv.value === observedAbv.value) {
    const viaProof = observedAbv.source === 'proof' || expectedAbv.source === 'proof'
    return {
      field,
      state: 'MATCH',
      expected,
      observed,
      rule: 'Compared as numbers, ignoring format',
      ...(viaProof ? { explanation: 'Proof converted to alcohol by volume.' } : {}),
    }
  }

  return {
    field,
    state: 'MISMATCH',
    expected,
    observed,
    rule: 'Compared as numbers, ignoring format',
    explanation: `Application states ${expectedAbv.value}%, the label states ${observedAbv.value}%.`,
  }
}

function compareQuantity(field: FieldName, expected: string, observed: string): FieldVerdict {
  const expectedQty = parseQuantity(expected)
  const observedQty = parseQuantity(observed)

  if (observedQty === null) {
    return {
      field,
      state: 'UNREADABLE',
      expected,
      observed,
      rule: 'No net contents could be read from this text',
    }
  }

  if (expectedQty === null) {
    return {
      field,
      state: 'MISMATCH',
      expected,
      observed,
      rule: 'The application value could not be read as a quantity',
    }
  }

  // Exact when the units already agree. A tolerance applies only where a
  // conversion took place, because the imprecision comes from the conversion
  // rather than from any permitted variance (see CONVERSION_TOLERANCE).
  const converted =
    expectedQty.unit !== observedQty.unit && !expectedQty.unitAssumed && !observedQty.unitAssumed
  const larger = Math.max(expectedQty.milliliters, observedQty.milliliters)
  const allowed = converted ? larger * CONVERSION_TOLERANCE : 0.5
  if (Math.abs(expectedQty.milliliters - observedQty.milliliters) > allowed) {
    return {
      field,
      state: 'MISMATCH',
      expected,
      observed,
      rule: 'Compared by volume, after converting units',
    }
  }

  if (observedQty.unitAssumed) {
    return {
      field,
      state: 'LOW_CONFIDENCE',
      expected,
      observed,
      rule: 'Compared by volume, after converting units',
      explanation: 'No unit was found on the label; millilitres assumed. Please double-check.',
    }
  }

  return {
    field,
    state: 'MATCH',
    expected,
    observed,
    rule: 'Compared by volume, after converting units',
    ...(converted ? { explanation: 'Units differ but the volume is the same.' } : {}),
  }
}

/** Compare one field. Exported so each rule can be unit-tested directly. */
export function compareField(
  field: FieldName,
  expected: string | null,
  observed: ObservedField,
): FieldVerdict {
  const early = preCompare(field, expected, observed)
  if (early !== null) return early

  const expectedValue = (expected ?? '').trim()
  const observedValue = (observed.raw ?? '').trim()

  let verdict: FieldVerdict
  switch (FIELD_RULE[field]) {
    case 'tolerant-text':
      verdict = compareTolerantText(field, expectedValue, observedValue)
      break
    case 'numeric':
      verdict = compareNumeric(field, expectedValue, observedValue)
      break
    case 'quantity':
      verdict = compareQuantity(field, expectedValue, observedValue)
      break
  }

  return applyConfidence(verdict, observed.confidence)
}

/** Compare every field, in checklist order (§5.3 P4). */
export function compareFields(
  application: ApplicationData,
  extraction: Extraction,
): readonly FieldVerdict[] {
  return FIELDS.map((field) => compareField(field, application[field], extraction.fields[field]))
}

/** Exported for the normalisation unit tests. */
export { normalizeText }
