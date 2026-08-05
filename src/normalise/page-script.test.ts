import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RENDER_SCRIPT } from './browser-normaliser.js'
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

describe('the render script gets every argument it declares', () => {
  /*
   * The silent failure this guards against, which has a name and a cost.
   *
   * `page.evaluate` is handed a built invocation, so a parameter added to the
   * script without a matching argument at a call site is not an error — it is
   * `undefined`. `recordRegion` arriving undefined would be falsy, the record
   * would be cropped as a whole page, and for a form filed on its own that page
   * is the one carrying the label. The "application record" would then be read
   * off the artwork it is about to be compared against, every field would match
   * itself, and every submission would pass.
   *
   * Nothing else would notice: the images are the right size, the JSON is
   * well-formed, and the verdict is CLEAR.
   */
  const declared = (script: string): string[] => {
    const params = /^\s*async\s*\(([^)]*)\)/.exec(script)?.[1] ?? ''
    return params
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p !== '')
  }

  it('declares the parameters this suite thinks it does', () => {
    expect(declared(RENDER_SCRIPT)).toEqual([
      'pdfBase64',
      'dpi',
      'region',
      'labelPage',
      'recordPage',
      'pdfjsUrl',
      'workerUrl',
      'recordRegion',
    ])
  })

  it('is invoked with exactly that many arguments, everywhere', () => {
    // Counted off the source rather than the runtime: both call sites live
    // inside a method that needs a browser to reach.
    // Relative to the project root, which is where vitest runs. A wrong path
    // throws rather than quietly asserting over an empty string.
    const source = readFileSync('src/normalise/browser-normaliser.ts', 'utf8')
    const invocations = [...source.matchAll(/buildInvocation\(RENDER_SCRIPT, \[([\s\S]*?)\]\)/g)]
    expect(invocations.length).toBeGreaterThanOrEqual(2)
    for (const [, args] of invocations) {
      const count = (args ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('//')).length
      expect(count).toBe(declared(RENDER_SCRIPT).length)
    }
  })
})
