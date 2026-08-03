/**
 * Base64 for an image payload.
 *
 * One implementation. There were three — the worker entry, this adapter layer,
 * and the browser normaliser — all chunked against the same call-stack limit,
 * all written separately, none knowing about the others.
 */

/** Chunked, so a 300 DPI crop cannot overflow the call stack. */
export function toBase64(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
