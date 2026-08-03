import { describe, expect, it } from 'vitest'
import { buildInvocation } from './page-script.js'

/** Evaluate an expression the way `page.evaluate` would evaluate a string. */
// Evaluating for real, rather than asserting on the string's shape: the bug
// this guards was an expression that looked like a call and was not one, and a
// structural assertion would have passed it.
const evaluate = (expression: string): unknown => new Function(`return ${expression}`)()

describe('in-page invocation', () => {
  // The regression. Passing the source and the arguments separately produced an
  // expression that merely *defined* a function: it evaluated to the function
  // itself, never ran, and every submission failed as an unrecognised form.
  it('calls the function rather than merely defining it', () => {
    expect(evaluate(buildInvocation('(a, b) => a + b', [2, 3]))).toBe(5)
  })

  it('does not evaluate to a function', () => {
    expect(typeof evaluate(buildInvocation('() => 1', []))).not.toBe('function')
  })

  it('passes every argument through, in order', () => {
    const source = '(...xs) => xs.join("|")'
    expect(evaluate(buildInvocation(source, ['a', 'b', 'c']))).toBe('a|b|c')
  })

  it('preserves object arguments, which the region map relies on', () => {
    const region = { x0: 24.6, y0: 28.9, x1: 589.4, y1: 326.8 }
    const source = '(r) => r.x1 - r.x0'
    expect(evaluate(buildInvocation(source, [region]))).toBeCloseTo(564.8)
  })

  // The PDF arrives as base64 and the script source spans many lines; neither
  // may break the expression it is embedded in.
  it('escapes string arguments safely', () => {
    const nasty = 'a")(\n// ignore me\n"b'
    expect(evaluate(buildInvocation('(s) => s.length', [nasty]))).toBe(nasty.length)
  })

  it('accepts multi-line function source', async () => {
    const source = `
      async (n) => {
        return n * 2
      }
    `
    await expect(evaluate(buildInvocation(source, [21]))).resolves.toBe(42)
  })
})
