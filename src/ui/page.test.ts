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
