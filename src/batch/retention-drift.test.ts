/**
 * The guard that fires when the promise and the practice disagree.
 *
 * Worth its own test because it is the one check here that will only ever run
 * in anger: everything else is exercised every deploy, and this fires the day
 * someone changes the window and forgets what the system tells applicants.
 */

import { describe, expect, it } from 'vitest'
import { retentionPolicyText, retentionWindowDays } from './retention.js'

describe('stated versus enforced retention', () => {
  it('agrees when the recorded policy matches the configured window', () => {
    const stated = retentionPolicyText(14)
    const days = retentionWindowDays({ RETENTION_WINDOW_DAYS: '14' })
    expect(days).not.toBeNull()
    expect(retentionPolicyText(days as number)).toBe(stated)
  })

  // The failure this exists for: the window is changed, the recorded promise
  // is not, and the deployment now deletes content on one schedule while
  // telling applicants another.
  it('disagrees when the window moves and the record does not', () => {
    const stated = retentionPolicyText(14)
    const days = retentionWindowDays({ RETENTION_WINDOW_DAYS: '30' })
    expect(retentionPolicyText(days as number)).not.toBe(stated)
  })
})
