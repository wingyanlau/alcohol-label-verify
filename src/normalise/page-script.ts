/**
 * Building an in-page invocation.
 *
 * The render script is held as source text, not as a real function, because it
 * uses a dynamic `import()` of pdf.js from a CDN — as bundled code esbuild
 * would rewrite that import and the browser would never fetch it.
 *
 * The consequence is easy to get wrong, and was: `page.evaluate(source, a, b)`
 * with a *string* first argument evaluates the string as an expression and
 * ignores the arguments entirely. The page dutifully evaluated an arrow
 * function literal, returned nothing serialisable, and every submission failed
 * with `page size NaNxNaNpt, undefined page(s)` — a shape probe that had never
 * run, reported as an unrecognised form.
 *
 * So the call is built explicitly. The arguments are serialised into the
 * expression, which is the only way they reach a string-form evaluate.
 */

/**
 * Wrap function source in an expression that *calls* it with `args`.
 *
 * Arguments are JSON-serialised, so they must be JSON-representable — which
 * every argument here is: base64 text, numbers, and a plain region record.
 */
export function buildInvocation(source: string, args: readonly unknown[]): string {
  const serialised = args.map((a) => JSON.stringify(a) ?? 'undefined').join(', ')
  return `(${source.trim()})(${serialised})`
}
