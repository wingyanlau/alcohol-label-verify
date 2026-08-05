/**
 * The shared-credential gate (D49).
 *
 * A prototype on a public URL that calls a metered inference API is a bill
 * anyone can run up. This is a door on the deployment, and the tests below pin
 * what it is and — more importantly — what it is *not*.
 *
 * **It is not authentication of anybody.** One credential, shared, handed to a
 * reviewer. It establishes that the caller was given the credential, and
 * nothing whatsoever about who they are. Every name in the record is still
 * declared rather than verified (D14, §19.5), and a decision recorded against
 * "Dave Mitchell" is still a claim by whoever typed it.
 */

import { describe, expect, it } from 'vitest'
import { checkGate, gateChallenge } from './gate.js'

const configured = {
  POC_USER_ONE: 'reviewer',
  POC_USER_ONE_PASSWORD: 'correct horse',
  POC_USER_TWO: 'second-reviewer',
  POC_USER_TWO_PASSWORD: 'battery staple',
}
const authorised = (user: string, password: string) =>
  new Request('https://x.test/review', {
    headers: { authorization: `Basic ${btoa(`${user}:${password}`)}` },
  })

describe('the gate', () => {
  it('lets a correct credential through', () => {
    expect(checkGate(authorised('reviewer', 'correct horse'), configured)).toBe(true)
  })

  it('refuses a wrong password', () => {
    expect(checkGate(authorised('reviewer', 'wrong'), configured)).toBe(false)
  })

  it('refuses a wrong user', () => {
    expect(checkGate(authorised('someone', 'correct horse'), configured)).toBe(false)
  })

  it('refuses a request carrying nothing', () => {
    expect(checkGate(new Request('https://x.test/review'), configured)).toBe(false)
  })

  it('refuses a malformed header rather than throwing', () => {
    // A gate that throws on a bad header is a gate that returns 500 to a
    // scanner and 500 to the reviewer who fat-fingered a paste.
    for (const value of ['Basic', 'Basic !!!!', 'Bearer abc', '', 'Basic ' + btoa('nocolon')]) {
      const request = new Request('https://x.test/review', { headers: { authorization: value } })
      expect(checkGate(request, configured), value).toBe(false)
    }
  })

  it('admits the second reviewer as readily as the first', () => {
    // Two pairs so two people can evaluate at once, and so revoking one does
    // not lock out the other.
    expect(checkGate(authorised('second-reviewer', 'battery staple'), configured)).toBe(true)
  })

  it('does not let one reviewer wear the other half of the pair', () => {
    expect(checkGate(authorised('reviewer', 'battery staple'), configured)).toBe(false)
    expect(checkGate(authorised('second-reviewer', 'correct horse'), configured)).toBe(false)
  })

  it('is open when no credential is configured', () => {
    // Deliberate, and the reason is `wrangler dev`: a gate that closed when
    // unconfigured would brick local development and every test that builds a
    // Request. The deployment that needs the door is the one that sets the
    // secret, and CI says which state it left staging in.
    expect(checkGate(new Request('https://x.test/'), {})).toBe(true)
  })

  it('ignores half a credential rather than accepting an empty password', () => {
    // Half a pair configured by accident must not become a credential whose
    // password is the empty string.
    const halves = [
      { POC_USER_ONE: 'reviewer' },
      { POC_USER_ONE_PASSWORD: 'correct horse' },
      { POC_USER_TWO: 'second-reviewer' },
    ]
    for (const half of halves) {
      expect(checkGate(new Request('https://x.test/'), half), JSON.stringify(half)).toBe(true)
      expect(checkGate(authorised('reviewer', ''), half), JSON.stringify(half)).toBe(true)
    }
  })

  it('closes as soon as one complete pair exists', () => {
    const one = { POC_USER_ONE: 'reviewer', POC_USER_ONE_PASSWORD: 'correct horse' }
    expect(checkGate(new Request('https://x.test/'), one)).toBe(false)
    expect(checkGate(authorised('reviewer', 'correct horse'), one)).toBe(true)
    // The second pair being unset is not a way in.
    expect(checkGate(authorised('', ''), one)).toBe(false)
  })

  it('does not leak which half was wrong', () => {
    // The challenge is one sentence regardless. "Unknown user" tells a guesser
    // which half to keep.
    const forUser = gateChallenge()
    expect(forUser.status).toBe(401)
    expect(forUser.headers.get('www-authenticate')).toMatch(/^Basic realm=/)
  })

  it('asks the browser to prompt, so a reviewer needs no instructions', () => {
    expect(gateChallenge().headers.get('www-authenticate')).toContain('charset="UTF-8"')
  })

  it('is never cached by anything in between', () => {
    expect(gateChallenge().headers.get('cache-control')).toBe('no-store')
  })
})
