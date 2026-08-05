/**
 * The one page served without a credential.
 *
 * Its job is to make the password prompt make sense. A bare URL that answers
 * 401 is indistinguishable from a broken server, and an evaluator who cannot
 * tell the difference will assume the second.
 *
 * What it must never do is leak past the gate it sits in front of.
 */

import { describe, expect, it } from 'vitest'
import { LANDING_HTML } from './landing.js'

describe('the landing page', () => {
  it('spells the agency out', () => {
    expect(LANDING_HTML).toContain('Alcohol and Tobacco Tax and Trade Bureau')
  })

  it('explains before it asks', () => {
    expect(LANDING_HTML).toContain('TTB F 5100.31')
    expect(LANDING_HTML.replace(/\s+/g, ' ')).toMatch(/cost control/)
    expect(LANDING_HTML).toContain('Open the prototype')
  })

  it('carries the guided path a reviewer should follow', () => {
    for (const screen of ['Single review', 'Batch', 'Policy', 'Agents', 'Audit', 'Measurement']) {
      expect(LANDING_HTML, screen).toContain(screen)
    }
  })

  it('asks the reviewer to make a determination, not just to look', () => {
    // A menu of screens is not a demo. The arc that matters is: read the
    // evidence, decide, then audit the record your decision created.
    const flat = LANDING_HTML.replace(/\s+/g, ' ')
    expect(flat).toMatch(/Make a determination/i)
    expect(flat).toMatch(/approve/i)
    expect(flat).toMatch(/reject/i)
    expect(flat).toMatch(/Audit what you just decided/i)
  })

  it('opens on prepared work rather than asking the reviewer to start it', () => {
    // The architecture's own claim, told correctly: filings are checked as they
    // arrive, so an agent finds the work done. A demo that opens empty and asks
    // for a button press tells the opposite story.
    const flat = LANDING_HTML.replace(/\s+/g, ' ')
    expect(flat).toMatch(/The run is already there/i)
    expect(flat).toMatch(/does not arrive and press a button/i)
  })

  it('says what to notice, not only what to click', () => {
    // Every interesting property here is easy to walk past — that the system
    // never says "approved", that a refused file fails alone, that the audit
    // draws no conclusion of its own.
    const flat = LANDING_HTML.replace(/\s+/g, ' ')
    expect(flat).toMatch(/never says <em>approved<\/em>/i)
    expect(flat).toMatch(/failed alone/i)
    expect(flat).toMatch(/offers no conclusion of its own/i)
  })

  it('states the assumption the five-second answer rests on', () => {
    // The architectural point, and the one most likely to be misread as a
    // performance claim: nobody waits for the model on the batch path.
    expect(LANDING_HTML.replace(/\s+/g, ' ')).toMatch(/as they arrive/i)
    expect(LANDING_HTML.replace(/\s+/g, ' ')).toMatch(/never waits for inference/i)
  })

  it('says what it is not, on the public page rather than only inside', () => {
    // The three overclaims a reviewer would otherwise have to disprove.
    expect(LANDING_HTML).toMatch(/Perception is non-deterministic/)
    expect(LANDING_HTML).toMatch(/No percentage is claimed/)
    expect(LANDING_HTML).toMatch(/declared, not verified/)
  })

  it('contains no credential and no deployment address', () => {
    // It is public. A username, a password or the host would each defeat the
    // gate it introduces.
    expect(LANDING_HTML).not.toMatch(/workers\.dev/)
    expect(LANDING_HTML).not.toMatch(/POC_USER|password\s*[:=]\s*\S/i)
  })

  it('calls nothing, because it must render unauthenticated', () => {
    // A fetch to a gated endpoint would 401 and leave the page half-built for
    // exactly the visitor it exists to serve.
    expect(LANDING_HTML).not.toContain('fetch(')
    expect(LANDING_HTML).not.toContain('<script')
  })
})
