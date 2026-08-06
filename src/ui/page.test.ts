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

describe('the product type, now read rather than declared (D25)', () => {
  /*
   * The screen used to ask an agent to pick the product type from a dropdown.
   * It is item 5 of the form they were holding, so the form is read instead —
   * and the dropdown had to go with it, because the two would be a question
   * whose answer the system already had, with no way to tell which one selected
   * the rules.
   */
  it('does not ask a person to declare it', () => {
    expect(PAGE_HTML).not.toContain('<select id="productType"')
    for (const type of GOVERNED_PRODUCT_TYPES) {
      expect(PAGE_HTML, type).not.toContain(`<option value="${type}">`)
    }
  })

  it('reports what selected the rules, on the result', () => {
    // Named on screen because "no rules applied" and "no rule could be
    // selected" look identical without it — and the second means the label was
    // never examined against any regulation at all.
    expect(PAGE_HTML).toContain('read from item 5 of the application')
  })

  it('says plainly when nothing could be selected', () => {
    expect(PAGE_HTML).toContain('No product type could be read from item 5')
    expect(PAGE_HTML).toContain('has been checked against any regulation')
  })

  it('sends the filed PDF, not typed fields', () => {
    expect(PAGE_HTML).toContain("form.append('submission'")
    expect(PAGE_HTML).not.toContain("form.append('productType'")
    expect(PAGE_HTML).not.toContain("form.append('brandName'")
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

describe('a failed start says what failed (D38)', () => {
  it('reads the response body even when the request failed', () => {
    // The server puts the real cause in "detail". Throwing the response away
    // gave an agent a sentence that named nothing, and gave whoever they
    // reported it to no more.
    expect(PAGE_HTML).toContain('body.detail')
  })

  it('still leads with the sentence an agent can act on', () => {
    // The cause is appended, not substituted. "Nothing was saved" is what tells
    // them it is safe to press it again.
    expect(PAGE_HTML).toContain('The check could not be started. Nothing was saved.')
  })
})

describe('the order of the tabs (§4.1)', () => {
  /*
   * Order is a claim about what the tool is for, so it is pinned rather than
   * left to whoever edits the markup next.
   *
   * The worklist comes first because it is what an agent arrives to: filings
   * are checked as they arrive, so the ordinary start of a shift is a queue of
   * prepared work. Single review is the exception — one case in front of them
   * right now — and opening on the exception told the wrong story about how the
   * five-second requirement is met.
   */
  const positionOf = (id: string) => PAGE_HTML.indexOf(`id="${id}"`)

  it('puts the worklist before single review', () => {
    expect(positionOf('modeBatch')).toBeGreaterThan(-1)
    expect(positionOf('modeBatch')).toBeLessThan(positionOf('modeSingle'))
  })

  it('lands on the worklist', () => {
    expect(PAGE_HTML).toContain("showMode('batch')")
  })

  it('orders the reference screens by how often they are needed', () => {
    // Audit and Measurement answer questions about work just done; Agents and
    // Policy explain the standing arrangement and are read far less often.
    const order = ['modeAudit', 'modeMeasure', 'modeAgents', 'modePolicy'].map(positionOf)
    expect(order.every((n) => n > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('keeps the work and the reference screens in separate groups', () => {
    // Four equal buttons in a row made the choice look like four equal jobs.
    expect(PAGE_HTML).toContain('aria-label="What to check"')
    expect(PAGE_HTML).toContain('aria-label="How this system is governed"')
  })
})

describe('finding the way back, and who this is for', () => {
  it('spells the agency out rather than leaving an initialism', () => {
    // "TTB" is the brief's shorthand, and the heading is where a reviewer first
    // meets it. Expanded there, not only in the small print below.
    expect(PAGE_HTML).toContain('<h1>Alcohol Beverage Label Check</h1>')
    expect(PAGE_HTML).toContain('Alcohol and Tobacco Tax and Trade Bureau (TTB)')
    expect(PAGE_HTML).not.toMatch(/<h1>[^<]*TTB/)
  })

  it('offers a way back to the demo guide from every screen', () => {
    // The guide is the only page that says what to do; landing in the
    // application with no route back to it strands a reviewer mid-run.
    expect(PAGE_HTML).toMatch(/href="\/"[^>]*>\s*Demo guide|>Demo guide</)
  })
})

describe('the re-read belongs to the audit, and nowhere else', () => {
  /*
   * It was offered twice: beside the decision, and inside the audit. Beside the
   * decision it asked the wrong person the wrong question — an agent judging a
   * label against an application is not adjudicating whether the model is
   * reproducible, and the panel said so itself, which is the tell. It also
   * spent a metered call at the moment attention was scarcest.
   */
  it('offers it only from the audit', () => {
    // Three occurrences, all one button: its label, and the two paths that
    // restore that label once the call settles or fails. Counting them is not
    // the point — every one carrying the audit's wording is, because the
    // decision screen's button was the bare phrase.
    const triggers = PAGE_HTML.match(/[A-Za-z ]*ask the model again/gi) ?? []
    expect(triggers.length).toBeGreaterThan(0)
    for (const t of triggers) expect(t.trim()).toBe('Also ask the model again')
  })

  it('does not offer one beside the decision', () => {
    expect(PAGE_HTML).not.toContain('Check the reading')
    expect(PAGE_HTML).not.toContain('renderReread(')
  })
})
