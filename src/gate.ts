/**
 * A door on the deployment (D49).
 *
 * This prototype sits on a public URL and calls a metered inference API. A
 * batch is 26 submissions; `/health/inference` is a model call; `/review` is
 * two. Anyone who finds the address can spend somebody else's quota, and the
 * first sign would be a bill or a hard 429 in the middle of an evaluation.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 *
 * **It is not authentication, and nothing here should ever be described as
 * such.** One credential, shared, handed to whoever is evaluating this. It
 * establishes that the caller was given the credential and nothing at all about
 * who they are. Every name in the record remains *declared* (D14, §19.5): a
 * decision recorded against "Dave Mitchell" is still a claim by whoever typed
 * it, and the agent register says exactly that on its face.
 *
 * The distinction matters because a gate is the sort of thing that gets
 * mistaken for a login later, and the audit record's honesty rests on nobody
 * making that mistake.
 *
 * **It is a cost control**, which is why it covers the cheap routes too. A
 * static page nobody pays for is not worth protecting; a health probe that
 * calls a model is, and leaving it open would defeat the point by the
 * cheapest available route.
 */

/**
 * The credentials, read from the environment. None configured means the door is
 * open.
 *
 * **Two pairs, not one.** Two people can be evaluating this at once, and a
 * single shared credential means revoking one reviewer's access locks out the
 * other and needs a redeploy to restore. Two also makes rotation a change to
 * one half rather than an outage for everybody.
 *
 * They are still not accounts. Which credential was used says which link was
 * handed out, not who is holding it, and nothing in the record is attributed
 * from it — see the module comment.
 */
export interface GateConfig {
  readonly POC_USER_ONE?: string | undefined
  readonly POC_USER_ONE_PASSWORD?: string | undefined
  readonly POC_USER_TWO?: string | undefined
  readonly POC_USER_TWO_PASSWORD?: string | undefined
}

/**
 * The complete pairs, in configuration order.
 *
 * A pair with either half missing is **not** a credential and is dropped: half
 * a credential configured by accident would otherwise become an empty password
 * that something, somewhere, is willing to match.
 */
function credentials(config: GateConfig): Array<readonly [string, string]> {
  const pairs: Array<readonly [string | undefined, string | undefined]> = [
    [config.POC_USER_ONE, config.POC_USER_ONE_PASSWORD],
    [config.POC_USER_TWO, config.POC_USER_TWO_PASSWORD],
  ]
  const complete: Array<readonly [string, string]> = []
  for (const [user, password] of pairs) {
    const u = (user ?? '').trim()
    const p = password ?? ''
    if (u !== '' && p !== '') complete.push([u, p])
  }
  return complete
}

/**
 * Compare without revealing where two strings first differ.
 *
 * The timing signal here is small and the threat is remote — but a guessable
 * credential guarding a metered API is exactly the case where "small" is worth
 * an eight-line function. Length is compared first and separately, which does
 * leak length; that is accepted, because padding to a fixed size costs more
 * than the fact that a password has a length is worth.
 */
function equals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Whether this request may proceed.
 *
 * **Open when unconfigured**, deliberately. A gate that closed without a
 * credential would brick `wrangler dev` and every test that constructs a
 * Request, and would turn a forgotten secret into an outage rather than into an
 * open door on a demo. The deployment that needs the door is the one that sets
 * the secret; CI asserts that staging has.
 */
export function checkGate(request: Request, config: GateConfig): boolean {
  const allowed = credentials(config)
  if (allowed.length === 0) return true

  const header = request.headers.get('authorization') ?? ''
  const [scheme, encoded] = header.split(' ')
  if (scheme?.toLowerCase() !== 'basic' || encoded === undefined) return false

  let decoded: string
  try {
    decoded = atob(encoded)
  } catch {
    // A header that is not valid base64 is a refusal, not a 500. A gate that
    // throws answers a scanner and a fat-fingered paste the same way, and only
    // one of them deserves an error page.
    return false
  }

  // Split on the FIRST colon only: a password may contain one, a username may
  // not (RFC 7617).
  const colon = decoded.indexOf(':')
  if (colon < 0) return false
  const offeredUser = decoded.slice(0, colon)
  const offeredPassword = decoded.slice(colon + 1)

  // Every pair is checked even after one has matched, and both halves of each
  // even after one has failed. An early return would make "no such user"
  // measurably cheaper than "wrong password", which tells a guesser which half
  // to keep.
  let matched = false
  for (const [user, password] of allowed) {
    const userOk = equals(offeredUser, user)
    const passwordOk = equals(offeredPassword, password)
    if (userOk && passwordOk) matched = true
  }
  return matched
}

/**
 * The refusal.
 *
 * One sentence whichever half was wrong — "unknown user" would tell a guesser
 * which half to keep. `WWW-Authenticate` makes the browser prompt, so a
 * reviewer handed a URL and a credential needs no instructions beyond those
 * two things.
 */
export function gateChallenge(): Response {
  return new Response(
    'This deployment is a prototype and asks for a credential, because checking a ' +
      'label calls a metered service. If you are evaluating it, the credential came ' +
      'with the link.\n',
    {
      status: 401,
      headers: {
        // ASCII only, and not for style: a header value is a ByteString, so
        // the em dash this realm first carried threw on construction — the
        // gate answering 500 instead of 401 to every unauthenticated request.
        //
        // charset is what stops a non-ASCII PASSWORD being mangled by the
        // browser's own guess at an encoding. It says nothing about the realm.
        'www-authenticate': 'Basic realm="TTB Label Check (prototype)", charset="UTF-8"',
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )
}
