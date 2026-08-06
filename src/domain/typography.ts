/**
 * Measuring the §16.22 typography requirements (D53).
 *
 * The checklist used to tell an agent these "cannot be verified from an image".
 * That was false for most of them: §16.22 states numbers — 1/2/3 mm by
 * container volume in (b), and 40/25/12 characters per inch in (a)(4) — and the
 * scale needed to reach them is already in the record. A page rendered at a
 * known DPI from a PDF whose coordinates are points has an exact millimetre per
 * pixel, and `extraction.raster_dpi` has been stored since the first migration.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PRODUCES, AND WHAT IT IS NOT
 *
 * **Evidence, never a verdict.** The form states that TTB "does not routinely
 * review submitted labels for compliance with applicable requirements for
 * mandatory label information regarding type size, characters per inch, or
 * contrasting background" — the duty sits with the applicant, certified under
 * penalty of perjury. A blocking rule here would reject labels a COLA
 * specialist would pass, so these figures are shown beside the advisory checks
 * and the determination stays with the agent (D53).
 *
 * **A floor on precision, not a precise floor.** The box height comes from the
 * model, and a model's bounding box carries the model's error. The arithmetic
 * below is exact; its input is not, and a figure derived this way is an
 * estimate that happens to be expressed in millimetres.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY FUNCTION RETURNS null
 *
 * The dangerous output is not a wrong number, it is a *confident* one. A
 * millimetre figure derived from a missing input is indistinguishable
 * downstream from a measured one — it renders identically, cites the same
 * regulation, and reads as more authoritative than the human judgement it
 * displaced. So an absent or unusable input yields null, and the surface says
 * "not measured" rather than showing arithmetic performed on a default.
 *
 * The reduction percentage is where this bites hardest. Applicants must shrink
 * oversized labels to fit the affix box and declare the percentage in item 19;
 * an uncorrected reading under-measures every one of them, and under-measuring
 * produces a false discrepancy against a compliant label — the direction that
 * costs an agent's trust (N4).
 *
 * Pure: no clock, no randomness, no I/O, no platform types.
 */

/** Millimetres in an inch. The only physical constant this needs. */
const MM_PER_INCH = 25.4

/** A label affixed at actual size — no reduction. */
const NO_REDUCTION = 100

const usable = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0

/**
 * How many millimetres one rendered pixel spans.
 *
 * The PDF's own coordinate space is points, and the rasteriser renders at
 * `dpi/72` scale (`browser-normaliser.ts`), so this is exact for the *form*.
 * Whether the form's geometry equals the container's is what the reduction
 * percentage answers.
 */
export function millimetresPerPixel(dpi: number): number | null {
  return usable(dpi) ? MM_PER_INCH / dpi : null
}

/**
 * Item 19's declared reduction, as a percentage of actual size.
 *
 * Absent means actual size, which is the ordinary case and is why this returns
 * 100 rather than null for an empty value: the default belongs in one place,
 * and callers that substituted their own would drift apart.
 *
 * Zero is refused rather than treated as absent. It is not a reduction, and
 * dividing by it yields Infinity — which would render as a comfortably large
 * type size and pass every bound in this module.
 */
export function parseReductionPercent(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === '') return NO_REDUCTION
  const match = /(-?\d+(?:\.\d+)?)\s*(?:%|percent)?/i.exec(raw)
  if (match === null) return null
  const value = Number(match[1])
  // Above 100 would be an enlargement, which the form does not provide for;
  // it is more likely a misread than a claim, so it is refused.
  if (!usable(value) || value > NO_REDUCTION) return null
  return value
}

/** Scale a length measured on the form back up to the actual label. */
export function correctForReduction(measuredMm: number, reductionPercent: number): number | null {
  if (!usable(measuredMm) || !usable(reductionPercent)) return null
  return measuredMm * (NO_REDUCTION / reductionPercent)
}

/**
 * The height of the warning's type on the actual label, in millimetres.
 *
 * `boxHeightPx` is the model's box for the warning statement, in the pixels of
 * the rendered label crop — the same image the model read, so no second
 * coordinate space is involved.
 */
export function typeSizeMm(
  boxHeightPx: number,
  dpi: number,
  reductionPercent: number,
): number | null {
  const mmPerPx = millimetresPerPixel(dpi)
  if (mmPerPx === null || !usable(boxHeightPx)) return null
  return correctForReduction(boxHeightPx * mmPerPx, reductionPercent)
}

/**
 * §16.22(b) — the minimum type size for a container of this volume.
 *
 * Null when the volume is unknown, which is the common case on a genuine
 * filing: the paper form has no net contents box, and the value arrives only
 * where it is embossed on the container (D50). Choosing a default would compare
 * the label against a threshold nobody stated.
 */
export function minimumTypeSizeMm(netContentsMl: number | null): number | null {
  if (!usable(netContentsMl)) return null
  if (netContentsMl <= 237) return 1
  if (netContentsMl <= 3000) return 2
  return 3
}

/**
 * Characters per inch on the actual label.
 *
 * Density is a property of the label as printed, so the reduction correction
 * applies to the width: a label shrunk to 50% packs its characters into half
 * the space on the form, and reporting that density would double the real one.
 */
export function charactersPerInch(
  characters: number,
  lineWidthPx: number,
  dpi: number,
  reductionPercent: number,
): number | null {
  const mmPerPx = millimetresPerPixel(dpi)
  if (mmPerPx === null || !usable(characters) || !usable(lineWidthPx)) return null
  const widthMm = correctForReduction(lineWidthPx * mmPerPx, reductionPercent)
  if (widthMm === null) return null
  return characters / (widthMm / MM_PER_INCH)
}

/**
 * §16.22(a)(4) — the maximum character density permitted at a given type size.
 *
 * The regulation tabulates three sizes; a measurement lands between them. The
 * bound taken is that of the largest listed size the type has *reached*, which
 * is the reading that does not credit a label with a size it has not achieved:
 * 1.7 mm type is held to the 1 mm row's 40 cpi, not the 2 mm row's 25.
 *
 * Below 1 mm there is no row, and inventing one would report a density problem
 * on type that is already too small for any container — burying the first-order
 * finding under a second-order one.
 */
export function maxCharactersPerInch(typeSizeMillimetres: number | null): number | null {
  if (!usable(typeSizeMillimetres)) return null
  if (typeSizeMillimetres >= 3) return 12
  if (typeSizeMillimetres >= 2) return 25
  if (typeSizeMillimetres >= 1) return 40
  return null
}

/**
 * Everything the §16.22 advisory checks can be given, assembled in one place.
 *
 * Each figure stands alone. A model may locate the warning block and fail to
 * count its characters; a genuine filing may carry no net contents at all
 * (D50). Withholding the whole set because one input is missing would hide two
 * usable figures behind a third that was never available.
 */
export interface TypographyInput {
  readonly geometry: {
    readonly capHeightPx: number | null
    readonly longestLineCharacters: number | null
    readonly longestLineWidthPx: number | null
  } | null
  /** What the page was rendered at. Stored per read as `extraction.raster_dpi`. */
  readonly dpi: number | null
  /** Item 19, as printed. */
  readonly labelReduction: string | null
  /** From the application record, for the 16.22(b) threshold. */
  readonly netContentsMl: number | null
}

export interface TypographyMeasurement {
  readonly typeSizeMm: number | null
  readonly minimumTypeSizeMm: number | null
  /** Null means not comparable — not a pass, and not a failure. */
  readonly typeSizeMeets: boolean | null
  readonly charactersPerInch: number | null
  readonly maxCharactersPerInch: number | null
  readonly densityMeets: boolean | null
  /** The reduction actually applied, so a reader can see what was assumed. */
  readonly reductionPercent: number | null
  /**
   * Always true, and present so no consumer can render these as measurements.
   *
   * The arithmetic is exact. Its input is a bounding box a model reported, and
   * that error propagates undiminished into a figure that would otherwise read
   * as having been measured with an instrument (D53).
   */
  readonly estimated: true
}

const EMPTY: TypographyMeasurement = {
  typeSizeMm: null,
  minimumTypeSizeMm: null,
  typeSizeMeets: null,
  charactersPerInch: null,
  maxCharactersPerInch: null,
  densityMeets: null,
  reductionPercent: null,
  estimated: true,
}

export function measureWarningTypography(input: TypographyInput): TypographyMeasurement {
  const reduction = parseReductionPercent(input.labelReduction)
  // An unreadable item 19 is not "no reduction". Substituting 100 here would
  // under-measure every reduced label and report a discrepancy against a
  // compliant one, which is the direction that costs an agent's trust (N4).
  if (reduction === null || input.geometry === null || input.dpi === null) {
    return { ...EMPTY, reductionPercent: reduction }
  }

  const size = typeSizeMm(input.geometry.capHeightPx ?? 0, input.dpi, reduction)
  const minimum = minimumTypeSizeMm(input.netContentsMl)
  const density = charactersPerInch(
    input.geometry.longestLineCharacters ?? 0,
    input.geometry.longestLineWidthPx ?? 0,
    input.dpi,
    reduction,
  )
  // Keyed on the size actually measured, so the bound is the one this label has
  // earned rather than the one its container would permit.
  const maxDensity = maxCharactersPerInch(size)

  return {
    typeSizeMm: size,
    minimumTypeSizeMm: minimum,
    typeSizeMeets: size === null || minimum === null ? null : size >= minimum,
    charactersPerInch: density,
    maxCharactersPerInch: maxDensity,
    densityMeets: density === null || maxDensity === null ? null : density <= maxDensity,
    reductionPercent: reduction,
    estimated: true,
  }
}

/**
 * A figure, phrased for the one checklist item it informs.
 *
 * Two ids get one, and the rest get null on purpose. Bold is perception with no
 * instrument behind it; separateness has no measurement yet; firmly-affixed is
 * a property of the physical article. Putting a figure beside any of them would
 * imply a measurement exists, and the absence of one is the honest state.
 */
export interface AdvisoryMeasurement {
  readonly text: string
  /** Null where no bound applies — not a pass, and not a failure. */
  readonly meets: boolean | null
}

export function advisoryMeasurement(
  checkId: string,
  m: TypographyMeasurement,
): AdvisoryMeasurement | null {
  if (checkId === 'type_size' && m.typeSizeMm !== null) {
    const size = `estimated ${m.typeSizeMm.toFixed(2)} mm`
    return m.minimumTypeSizeMm === null
      ? {
          // Worth showing even with nothing to compare it to. Naming what is
          // missing sends the agent to the right place — the container volume,
          // not the artwork.
          text: `${size} — no minimum applies, because net contents was not stated`,
          meets: null,
        }
      : { text: `${size}, against the ${m.minimumTypeSizeMm} mm minimum`, meets: m.typeSizeMeets }
  }

  // Attached to the legibility row because that is where compression sits on
  // the checklist — and unlike the rest of that row, (a)(4) states a number.
  if (checkId === 'legibility' && m.charactersPerInch !== null) {
    const density = `estimated ${m.charactersPerInch.toFixed(0)} characters per inch`
    return m.maxCharactersPerInch === null
      ? { text: `${density} — no limit applies below 1 mm type`, meets: null }
      : {
          text: `${density}, against the ${m.maxCharactersPerInch} permitted at this size`,
          meets: m.densityMeets,
        }
  }

  return null
}

/**
 * A stored measurement, read back for a screen that shows an old verdict.
 *
 * Defensive on every field rather than trusting the column, and it never
 * throws. The figures are the least important thing on a detail screen; a
 * malformed JSON blob must not take the verdict, the findings and the decision
 * down with it. Null and a partial reading are both ordinary results.
 */
export function parseTypography(raw: string | null): TypographyMeasurement | null {
  if (raw === null || raw.trim() === '') return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const num = (k: string): number | null => {
    const n = v[k]
    return typeof n === 'number' && Number.isFinite(n) ? n : null
  }
  const bool = (k: string): boolean | null => (typeof v[k] === 'boolean' ? (v[k] as boolean) : null)
  return {
    typeSizeMm: num('typeSizeMm'),
    minimumTypeSizeMm: num('minimumTypeSizeMm'),
    typeSizeMeets: bool('typeSizeMeets'),
    charactersPerInch: num('charactersPerInch'),
    maxCharactersPerInch: num('maxCharactersPerInch'),
    densityMeets: bool('densityMeets'),
    reductionPercent: num('reductionPercent'),
    estimated: true,
  }
}
