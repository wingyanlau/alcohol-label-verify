/**
 * UT-T — §16.22 typography measurement (D53).
 *
 * The cases here are the ones that decide whether a figure may be shown at all.
 * Every function returns null rather than a number when an input is missing,
 * because the failure this guards is a confident millimetre derived from a
 * guess: it arrives with the authority of arithmetic and nothing downstream can
 * tell it apart from a measured one.
 */

import { describe, expect, it } from 'vitest'
import {
  advisoryMeasurement,
  charactersPerInch,
  correctForReduction,
  maxCharactersPerInch,
  measureWarningTypography,
  millimetresPerPixel,
  minimumTypeSizeMm,
  parseReductionPercent,
  parseTypography,
  typeSizeMm,
} from './typography.js'

describe('UT-T01 — scale from raster DPI', () => {
  it('derives millimetres per pixel from the DPI the page was rendered at', () => {
    // 25.4 mm to the inch. At 300 DPI a pixel is 25.4/300 mm.
    expect(millimetresPerPixel(300)).toBeCloseTo(0.084666, 5)
    expect(millimetresPerPixel(72)).toBeCloseTo(0.352777, 5)
  })

  it('refuses a DPI that cannot produce a scale', () => {
    for (const bad of [0, -300, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(millimetresPerPixel(bad), String(bad)).toBeNull()
    }
  })
})

describe('UT-T02 — item 19 reduction', () => {
  it('reads a declared percentage in the forms an applicant writes it', () => {
    for (const raw of ['50', '50%', ' 50 % ', 'reduced 50%', '50 percent']) {
      expect(parseReductionPercent(raw), raw).toBe(50)
    }
  })

  it('treats no declaration as no reduction, not as zero size', () => {
    // Absent means the label was affixed at actual size, which is the norm.
    // Returning null here and having the caller substitute 100 would put the
    // default in two places; it belongs in one.
    expect(parseReductionPercent(null)).toBe(100)
    expect(parseReductionPercent('')).toBe(100)
    expect(parseReductionPercent('   ')).toBe(100)
  })

  it('refuses percentages that cannot describe a reduction', () => {
    // 0% is not a reduction, it is a destroyed measurement: dividing by it
    // yields Infinity, which would render as a comfortably passing figure.
    for (const bad of ['0', '0%', '-20', 'half', 'abc']) {
      expect(parseReductionPercent(bad), bad).toBeNull()
    }
  })

  it('scales a measured length back up to the actual label', () => {
    // A label reduced to 50% measures half its true size on the form.
    expect(correctForReduction(1, 50)).toBeCloseTo(2, 6)
    expect(correctForReduction(2, 100)).toBeCloseTo(2, 6)
    expect(correctForReduction(1.6, 80)).toBeCloseTo(2, 6)
  })

  it('never silently corrects by an unusable percentage', () => {
    expect(correctForReduction(2, 0)).toBeNull()
    expect(correctForReduction(2, -50)).toBeNull()
  })
})

describe('UT-T03 — type size, 16.22(b)', () => {
  it('converts a measured box height to millimetres on the actual label', () => {
    // 20 px tall at 300 DPI is 1.693 mm on the form; at 50% reduction the
    // real label carries 3.387 mm.
    expect(typeSizeMm(20, 300, 100)).toBeCloseTo(1.6933, 3)
    expect(typeSizeMm(20, 300, 50)).toBeCloseTo(3.3866, 3)
  })

  it('declines rather than guessing when any input is unusable', () => {
    expect(typeSizeMm(20, 0, 100)).toBeNull()
    expect(typeSizeMm(0, 300, 100)).toBeNull()
    expect(typeSizeMm(20, 300, 0)).toBeNull()
  })

  it('applies the minimum for the container, by net contents', () => {
    // 16.22(b): up to 237 mL -> 1 mm; over 237 up to 3 L -> 2 mm; over 3 L -> 3 mm.
    expect(minimumTypeSizeMm(200)).toBe(1)
    expect(minimumTypeSizeMm(237)).toBe(1)
    expect(minimumTypeSizeMm(237.5)).toBe(2)
    expect(minimumTypeSizeMm(750)).toBe(2)
    expect(minimumTypeSizeMm(3000)).toBe(2)
    expect(minimumTypeSizeMm(3000.5)).toBe(3)
  })

  it('has no minimum to apply when the volume is unknown', () => {
    // Net contents is absent on a real filing unless embossed (D50). Choosing
    // a default would compare the label against an invented threshold.
    expect(minimumTypeSizeMm(null)).toBeNull()
    expect(minimumTypeSizeMm(0)).toBeNull()
    expect(minimumTypeSizeMm(-5)).toBeNull()
  })
})

describe('UT-T04 — characters per inch, 16.22(a)(4)', () => {
  it('counts characters against the width they occupy on the actual label', () => {
    // 40 characters across 300 px at 300 DPI is one inch, so 40 cpi.
    expect(charactersPerInch(40, 300, 300, 100)).toBeCloseTo(40, 6)
    // Reduced to 50%, that same inch is two inches on the real label, so the
    // characters are half as dense.
    expect(charactersPerInch(40, 300, 300, 50)).toBeCloseTo(20, 6)
  })

  it('declines on inputs that cannot yield a density', () => {
    expect(charactersPerInch(0, 300, 300, 100)).toBeNull()
    expect(charactersPerInch(40, 0, 300, 100)).toBeNull()
    expect(charactersPerInch(40, 300, 0, 100)).toBeNull()
  })

  it('applies the maximum density for the type size actually used', () => {
    // The table is keyed on type size, not container: 1 mm -> 40, 2 -> 25, 3 -> 12.
    expect(maxCharactersPerInch(1)).toBe(40)
    expect(maxCharactersPerInch(2)).toBe(25)
    expect(maxCharactersPerInch(3)).toBe(12)
  })

  it('applies the bound for the size band a measurement falls in', () => {
    // A real measurement is 1.7 mm, not exactly 1. The regulation states the
    // limit at each listed size, so a measured size takes the bound of the
    // largest listed size it has reached — 1.7 mm has met 1 mm, not 2 mm.
    expect(maxCharactersPerInch(1.7)).toBe(40)
    expect(maxCharactersPerInch(2.4)).toBe(25)
    expect(maxCharactersPerInch(9)).toBe(12)
  })

  it('has no bound below the smallest size the table covers', () => {
    // Under 1 mm the type is already too small for any container, and that is
    // 16.22(b)'s finding. Inventing a density limit here would report the
    // second-order problem and bury the first.
    expect(maxCharactersPerInch(0.8)).toBeNull()
    expect(maxCharactersPerInch(null)).toBeNull()
  })
})

describe('UT-T05 — the measurement an agent is shown', () => {
  const sound = {
    geometry: { capHeightPx: 24, longestLineCharacters: 60, longestLineWidthPx: 620 },
    dpi: 300,
    labelReduction: null,
    netContentsMl: 750,
  }

  it('reports both figures with the bound each is judged against', () => {
    const m = measureWarningTypography(sound)
    // 24 px at 300 DPI is 2.032 mm; the 750 mL container needs 2 mm.
    expect(m.typeSizeMm).toBeCloseTo(2.032, 3)
    expect(m.minimumTypeSizeMm).toBe(2)
    expect(m.typeSizeMeets).toBe(true)
    // 60 characters across 620 px at 300 DPI is 2.067 in, so 29 cpi — above
    // the 25 permitted at 2 mm.
    expect(m.charactersPerInch).toBeCloseTo(29.03, 1)
    expect(m.maxCharactersPerInch).toBe(25)
    expect(m.densityMeets).toBe(false)
  })

  it('states that every figure is an estimate', () => {
    // The arithmetic is exact; the box it starts from is a model observation.
    // A figure that does not say so reads as a measurement (D53).
    expect(measureWarningTypography(sound).estimated).toBe(true)
  })

  it('applies the item 19 reduction to both figures', () => {
    const m = measureWarningTypography({ ...sound, labelReduction: '50%' })
    expect(m.typeSizeMm).toBeCloseTo(4.064, 3)
    // Twice the size means half the density, and the bound moves with it.
    expect(m.charactersPerInch).toBeCloseTo(14.5, 1)
    expect(m.maxCharactersPerInch).toBe(12)
  })

  it('measures the type but withholds a comparison when the volume is unknown', () => {
    // The common case on a genuine filing: no net contents box (D50).
    const m = measureWarningTypography({ ...sound, netContentsMl: null })
    expect(m.typeSizeMm).toBeCloseTo(2.032, 3)
    expect(m.minimumTypeSizeMm).toBeNull()
    expect(m.typeSizeMeets).toBeNull()
    // Density does not depend on the container, so it survives.
    expect(m.maxCharactersPerInch).toBe(25)
    expect(m.densityMeets).toBe(false)
  })

  it('yields nothing at all when the reading carried no geometry', () => {
    const m = measureWarningTypography({ ...sound, geometry: null })
    expect(m.typeSizeMm).toBeNull()
    expect(m.charactersPerInch).toBeNull()
    expect(m.typeSizeMeets).toBeNull()
    expect(m.densityMeets).toBeNull()
  })

  it('refuses everything when the reduction is unusable', () => {
    // An unreadable item 19 is not "no reduction". Treating it as 100% would
    // under-measure a reduced label and report a false discrepancy (N4).
    const m = measureWarningTypography({ ...sound, labelReduction: '0%' })
    expect(m.typeSizeMm).toBeNull()
    expect(m.charactersPerInch).toBeNull()
    expect(m.reductionPercent).toBeNull()
  })

  it('measures each figure independently of the other', () => {
    // A model may locate the block and fail to count characters.
    const m = measureWarningTypography({
      ...sound,
      geometry: { ...sound.geometry, longestLineCharacters: null },
    })
    expect(m.typeSizeMm).toBeCloseTo(2.032, 3)
    expect(m.charactersPerInch).toBeNull()
    expect(m.densityMeets).toBeNull()
  })
})

describe('UT-T06 — the figure attached to a checklist item', () => {
  const measured = {
    typeSizeMm: 2.032,
    minimumTypeSizeMm: 2,
    typeSizeMeets: true,
    charactersPerInch: 29.03,
    maxCharactersPerInch: 25,
    densityMeets: false,
    reductionPercent: 100,
    estimated: true,
  } as const

  it('gives the type size check its figure and the bound it was judged against', () => {
    const a = advisoryMeasurement('type_size', measured)
    expect(a?.text).toContain('2.03 mm')
    expect(a?.text).toContain('2 mm')
    expect(a?.meets).toBe(true)
  })

  it('gives the legibility check the density figure, since (a)(4) states one', () => {
    const a = advisoryMeasurement('legibility', measured)
    expect(a?.text).toContain('29')
    expect(a?.text).toContain('25')
    expect(a?.meets).toBe(false)
  })

  it('says every figure is estimated', () => {
    // The word has to reach the screen. A reader who sees "2.03 mm" and not
    // "estimated" has been told the box was measured with an instrument.
    expect(advisoryMeasurement('type_size', measured)?.text).toMatch(/estimate/i)
  })

  it('attaches nothing to the checks it cannot inform', () => {
    // Bold is perception with no measurement behind it; firmly-affixed is not
    // in the image at all. A figure beside either would imply one exists.
    for (const id of ['header_bold', 'remainder_not_bold', 'separateness', 'firmly_affixed']) {
      expect(advisoryMeasurement(id, measured), id).toBeNull()
    }
  })

  it('attaches nothing when nothing was measured', () => {
    const none = { ...measured, typeSizeMm: null, charactersPerInch: null }
    expect(advisoryMeasurement('type_size', none)).toBeNull()
    expect(advisoryMeasurement('legibility', none)).toBeNull()
  })

  it('shows the figure without a comparison when there is no bound', () => {
    // No net contents means no minimum. The measurement is still worth seeing;
    // presenting it as passing or failing would invent the threshold.
    const noBound = { ...measured, minimumTypeSizeMm: null, typeSizeMeets: null }
    const a = advisoryMeasurement('type_size', noBound)
    expect(a?.text).toContain('2.03 mm')
    expect(a?.meets).toBeNull()
    expect(a?.text).toMatch(/net contents|container|volume/i)
  })
})

describe('UT-T07 — reading a stored measurement back', () => {
  const stored = {
    typeSizeMm: 2.032,
    minimumTypeSizeMm: 2,
    typeSizeMeets: true,
    charactersPerInch: 29.03,
    maxCharactersPerInch: 25,
    densityMeets: false,
    reductionPercent: 100,
    estimated: true,
  }

  it('restores what was shown when the verdict was written', () => {
    expect(parseTypography(JSON.stringify(stored))).toEqual(stored)
  })

  it('treats an absent column as no measurement', () => {
    // Every verdict written before the column existed, and every one since
    // where nothing could be measured.
    expect(parseTypography(null)).toBeNull()
    expect(parseTypography('')).toBeNull()
  })

  it('treats unreadable JSON as no measurement rather than throwing', () => {
    // A detail screen that fails to render because one column is malformed
    // hides a verdict an agent needs. The figures are the least important
    // thing on it.
    expect(parseTypography('{not json')).toBeNull()
    expect(parseTypography('[]')).toBeNull()
    expect(parseTypography('"2.03 mm"')).toBeNull()
  })

  it('drops a figure that is not a number rather than trusting the column', () => {
    const bad = JSON.stringify({ ...stored, typeSizeMm: '2.03' })
    expect(parseTypography(bad)?.typeSizeMm).toBeNull()
    expect(parseTypography(bad)?.charactersPerInch).toBeCloseTo(29.03, 2)
  })
})
