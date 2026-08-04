/**
 * Structured, payload-free logging (M7, D20, D28, NFR-7).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A CLOSED SET OF FIELDS AND NOT A FREE-FORM OBJECT
 *
 * "Logs never carry content" is trivially true the day it is written and
 * impossible to keep by discipline. Every later `console.log` is one careless
 * template literal away from putting a brand name, an applicant's address, or
 * the values read off a label into a log store that outlives the durable
 * record and has entirely different access rules. Nothing would fail; no test
 * would go red; the leak would be discovered by someone reading logs for an
 * unrelated reason, months later.
 *
 * So `LogEvent` enumerates every field that may be emitted, and there is no
 * index signature. **There is nowhere to put content.** Adding somewhere is an
 * edit to this file, which is a thing a reviewer will notice — the same move
 * as `RuleCitation`: shift the guarantee from what people remember to what the
 * compiler permits.
 *
 * The residual risk is honest and worth stating: nothing stops a caller
 * putting a brand name in `submissionId`. A type cannot know that an
 * identifier is really an identifier. What it can do is ensure no field
 * *invites* content, which removes the accident and leaves only deliberate
 * misuse.
 * ---------------------------------------------------------------------------
 *
 * Every field is one of four things — an identifier, a classification, a
 * version, or a number. If a proposed field is none of those, it is content.
 */
export interface LogEvent {
  /** What happened. Dotted and stable, so it can be filtered on. */
  readonly event: string

  /** Identifiers — what this concerned, never what it contained. */
  readonly jobId?: string
  readonly submissionId?: string
  readonly verdictId?: string

  /** Classifications — a closed vocabulary, never a quoted message (D38). */
  readonly outcome?: string
  readonly state?: string
  readonly fault?: string
  readonly reason?: string

  /**
   * The versioned identity set, as dimensions (D28).
   *
   * Metrics undimensioned by version can show that behaviour changed but never
   * what changed — and "the model changed" and "the rules changed" call for
   * opposite responses.
   */
  readonly provider?: string
  readonly modelId?: string
  readonly promptVersion?: string
  readonly rulesetVersion?: string
  readonly referenceDataVersion?: number

  /** Per-stage timings (M7). Where the latency table comes from. */
  readonly normaliseMs?: number
  readonly extractMs?: number
  readonly compareMs?: number
  readonly totalMs?: number

  /** Counts and settings. Numbers cannot carry a label value. */
  readonly attempt?: number
  readonly dpi?: number
  readonly problemCount?: number
  readonly bytes?: number
}

/**
 * Emit one event as a single JSON line.
 *
 * Undefined fields are dropped rather than emitted as nulls: a line dense with
 * nulls is a line nobody reads, and the fields that are present are the ones
 * that meant something for this event.
 */
export function emit(event: LogEvent): void {
  const line: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined && value !== null) line[key] = value
  }
  console.log(JSON.stringify(line))
}
