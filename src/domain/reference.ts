/**
 * Reference data — the statutory constants.
 *
 * Design reference: §3.6, D3.
 *
 * The warning text is configuration, not code. It is stated in exactly one
 * place and read from there, so a change in the regulation is a configuration
 * edit rather than a code change.
 *
 * The data is imported rather than read from disk: `src/domain` performs no
 * I/O (test-plan §17), and a Worker has no filesystem. `parseWarningReference`
 * validates whatever it is given, so a malformed file fails loudly at the
 * boundary rather than producing quiet nonsense in a verdict.
 */

import raw from '../../config/warning-statement.json'

export interface WarningSegment {
  readonly id: string
  readonly label: string
  readonly text: string
  readonly caseSensitive: boolean
  readonly caseSensitiveReason?: string
}

export interface WarningAdvisory {
  readonly id: string
  readonly text: string
  readonly citation: string
  readonly note?: string
}

export interface WarningReference {
  readonly configVersion: number
  readonly citation: string
  readonly appliesTo: string
  readonly verificationStatus: 'CONFIRMED' | 'UNCONFIRMED'
  readonly segments: readonly WarningSegment[]
  readonly advisoryChecks: readonly WarningAdvisory[]
}

/**
 * Validate an arbitrary value as reference data.
 *
 * Hand-written rather than schema-library based: this module must stay free of
 * runtime dependencies so it can be imported anywhere, including a browser.
 */
export function parseWarningReference(value: unknown): WarningReference {
  const fail = (why: string): never => {
    throw new Error(`warning reference data is invalid: ${why}`)
  }
  if (typeof value !== 'object' || value === null) return fail('not an object')
  const v = value as Record<string, unknown>

  if (typeof v.configVersion !== 'number' || !Number.isInteger(v.configVersion)) {
    return fail('configVersion must be an integer')
  }
  if (v.verificationStatus !== 'CONFIRMED' && v.verificationStatus !== 'UNCONFIRMED') {
    return fail('verificationStatus must be CONFIRMED or UNCONFIRMED')
  }
  if (!Array.isArray(v.segments) || v.segments.length === 0)
    return fail('segments must be non-empty')

  const segments = v.segments.map((s, i): WarningSegment => {
    if (typeof s !== 'object' || s === null) return fail(`segment ${i} is not an object`)
    const seg = s as Record<string, unknown>
    if (typeof seg.id !== 'string' || seg.id === '') return fail(`segment ${i} has no id`)
    if (typeof seg.text !== 'string' || seg.text === '')
      return fail(`segment ${seg.id} has no text`)
    if (typeof seg.caseSensitive !== 'boolean')
      return fail(`segment ${seg.id} has no caseSensitive`)
    return {
      id: seg.id,
      label: typeof seg.label === 'string' ? seg.label : seg.id,
      text: seg.text,
      caseSensitive: seg.caseSensitive,
    }
  })

  const advisoryChecks = (Array.isArray(v.advisoryChecks) ? v.advisoryChecks : []).map(
    (a): WarningAdvisory => {
      const adv = a as Record<string, unknown>
      return {
        id: String(adv.id ?? ''),
        text: String(adv.text ?? ''),
        citation: String(adv.citation ?? ''),
      }
    },
  )

  return {
    configVersion: v.configVersion,
    citation: String(v.citation ?? ''),
    appliesTo: String(v.appliesTo ?? ''),
    verificationStatus: v.verificationStatus,
    segments,
    advisoryChecks,
  }
}

let cached: WarningReference | null = null

/** The reference data shipped with the system. */
export function warningReference(): WarningReference {
  cached ??= parseWarningReference(raw)
  return cached
}

/**
 * True when the shipped text has not been checked against the primary source.
 *
 * Surfaced rather than hidden: FR-5 is word-for-word, so an unverified constant
 * makes every warning verdict provisional (M0, Q1a).
 */
export function referenceIsUnverified(ref: WarningReference = warningReference()): boolean {
  return ref.verificationStatus !== 'CONFIRMED'
}
