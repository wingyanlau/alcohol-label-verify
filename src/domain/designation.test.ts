/**
 * Resolving a printed designation to its class (27 CFR 5.141, 5.143).
 *
 * A label states a designation — "Kentucky Straight Bourbon Whiskey". Rules
 * that depend on the class need "Whisky". Nothing in the system could do that,
 * which blocked both the minimum-bottling-strength rule and any use of the
 * COLA Class/Type Code.
 */

import { describe, expect, it } from 'vitest'
import { resolveDesignation } from './designation.js'

describe('resolving a designation', () => {
  it('finds the class inside a full designation', () => {
    // 5.143(b) lets a place appear as part of the designation, and 5.141(d)
    // requires the words to appear together — so the class word is present.
    expect(resolveDesignation('Kentucky Straight Bourbon Whiskey').class?.name).toBe('Whisky')
    expect(resolveDesignation('New York Bourbon Whisky').class?.name).toBe('Whisky')
  })

  // 5.143(b) verbatim: "The word whisky may be spelled as either 'whisky' or
  // 'whiskey'." Both are compliant, and a set-membership test on one spelling
  // would report a confident false finding on a lawful label.
  it('accepts either spelling of whisky', () => {
    expect(resolveDesignation('Straight Rye Whisky').class?.name).toBe('Whisky')
    expect(resolveDesignation('Straight Rye Whiskey').class?.name).toBe('Whisky')
  })

  it('ignores capitalisation, as the comparison layer does', () => {
    expect(resolveDesignation('KENTUCKY STRAIGHT BOURBON WHISKEY').class?.name).toBe('Whisky')
  })

  it('resolves the simple classes', () => {
    expect(resolveDesignation('Gin').class?.name).toBe('Gin')
    expect(resolveDesignation('Distilled Gin').class?.name).toBe('Gin')
    expect(resolveDesignation('Peach Brandy').class?.name).toBe('Brandy')
    expect(resolveDesignation('Rum').class?.name).toBe('Rum')
  })

  // 5.141(b)(2): a product may conform to more than one class and be labelled
  // with any one of them. Two matches is a real ambiguity, not a tie to break —
  // picking the first would silently choose which rules apply.
  it('reports an ambiguous designation rather than guessing', () => {
    const r = resolveDesignation('Brandy Liqueur')
    expect(r.class).toBeNull()
    expect(r.candidates.length).toBeGreaterThan(1)
    expect(r.reason).toMatch(/more than one/i)
  })

  it('reports an unrecognised designation as unresolved, not as a breach', () => {
    // Absence of a match is ignorance, not a violation. The taxonomy is
    // class-level and incomplete, and a wrong finding here would be confident
    // and unfounded.
    const r = resolveDesignation('Old Tom Distillery Reserve')
    expect(r.class).toBeNull()
    expect(r.candidates).toHaveLength(0)
  })

  it('does not match a class name embedded inside another word', () => {
    // "Ginger" contains "gin". Whole words only, or a ginger liqueur becomes a
    // gin and inherits gin's 40% floor.
    expect(resolveDesignation('Ginger Spirit Drink').class).toBeNull()
  })

  it('carries the class minimum and its citation', () => {
    const r = resolveDesignation('Kentucky Straight Bourbon Whiskey')
    expect(r.class?.minimumBottlingAbv).toBe(40)
    expect(r.class?.citation).toBe('27 CFR 5.143')
  })
})

describe('the edges', () => {
  it('treats an empty or blank designation as nothing printed', () => {
    // Distinct from "unrecognised": the label may simply not carry one, which
    // is what DS-CLASS-TYPE-PRESENT is for. Conflating them would report a
    // missing designation as an unknown class.
    for (const blank of ['', '   ']) {
      const r = resolveDesignation(blank)
      expect(r.class).toBeNull()
      expect(r.reason).toMatch(/no designation/i)
    }
  })

  it('resolves a multi-word class stated the way a label states it', () => {
    // 5.150 says a label may read "Cordial" or "Liqueur"; the section HEADING
    // is "Cordials and liqueurs", which no label says. Matching on the heading
    // is what made "Brandy Liqueur" resolve to one class instead of two.
    expect(resolveDesignation('Coffee Liqueur').class?.name).toBe('Cordials and liqueurs')
    expect(resolveDesignation('Cordial').class?.name).toBe('Cordials and liqueurs')
  })

  it('carries no class minimum where the regulation states none', () => {
    // 5.148 agave spirits states no class-level bottling floor. Null is the
    // honest value; zero would read as "no limit" and satisfy any ABV.
    const agave = resolveDesignation('Agave Spirits')
    expect(agave.class?.minimumBottlingAbv).toBeNull()
  })
})
