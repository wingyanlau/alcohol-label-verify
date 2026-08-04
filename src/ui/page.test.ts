/**
 * The page, where it depends on something else being true.
 *
 * Most of this document is markup, and asserting markup is how tests become a
 * second copy of the design nobody updates. What is worth pinning is the part
 * that is *derived* — where the page and the policy set could drift apart
 * without anything failing.
 */

import { describe, expect, it } from 'vitest'
import { GOVERNED_PRODUCT_TYPES } from '../domain/findings.js'
import { PAGE_HTML } from './page.js'

describe('the product type field (D25)', () => {
  it('offers exactly the types the policy set governs', () => {
    // Product type decides which rules are applied. A form missing a type the
    // archive governs means those rules never fire — and nothing anywhere
    // reports that they did not.
    expect(GOVERNED_PRODUCT_TYPES.length).toBeGreaterThan(0)
    for (const type of GOVERNED_PRODUCT_TYPES) {
      expect(PAGE_HTML, type).toContain(`<option value="${type}">${type}</option>`)
    }
  })

  it('lets an agent leave it unstated rather than guess', () => {
    // Guessing a product type would select a body of regulation the applicant
    // never claimed. "Not stated" is honest, and the verdict then says nothing
    // could be checked.
    expect(PAGE_HTML).toContain('<option value="">Not stated</option>')
  })

  it('submits it with the rest of the application', () => {
    expect(PAGE_HTML).toContain("form.append('productType'")
  })
})

describe('the outcome vocabulary never reaches the screen (§12)', () => {
  it('renders the new judgement outcome in plain words', () => {
    expect(PAGE_HTML).toContain("case 'CLEAR_CONFIRM_POLICY'")
    expect(PAGE_HTML).toContain('Needs your judgement')
  })

  it('shows the recommendation under the headline', () => {
    expect(PAGE_HTML).toContain('d.recommendation')
  })
})

describe('the decision control (§18.5)', () => {
  it('offers all three decisions, not just approve and reject', () => {
    // Returning for better artwork is distinct from rejecting: it is not a
    // finding against the applicant, and collapsing the two would make every
    // unreadable scan look like the system was overruled.
    for (const decision of ['APPROVED', 'REJECTED', 'RETURNED']) {
      expect(PAGE_HTML, decision).toContain(`'${decision}'`)
    }
    expect(PAGE_HTML).toContain('Return for better artwork')
  })

  it('asks who is deciding', () => {
    // An unattributable approval is not an approval.
    expect(PAGE_HTML).toContain("who.id = 'decidedBy'")
  })

  it('is told whether the agent agreed rather than working it out', () => {
    // It had its own copy of the rule — a string-prefix test on the outcome
    // name — with no way to notice if it drifted from the one the agreement
    // statistics are drawn from.
    expect(PAGE_HTML).toContain('d.decision.agreed')
    expect(PAGE_HTML).not.toContain("indexOf('CLEAR')")
  })

  it('shows the server’s reason rather than inventing one', () => {
    // The server owns the sentence explaining why a departure needs a reason.
    // A second copy here would drift from it.
    expect(PAGE_HTML).toContain('res.body.reason')
  })
})
