/**
 * The front page — the only thing served without a credential.
 *
 * Everything else is behind the gate, which means an evaluator's first
 * experience was a browser password box with no context: no statement of what
 * this is, what it demonstrates, or what to look at. A password prompt on a bare
 * URL is indistinguishable from a misconfigured server.
 *
 * So this page explains before it asks. It is deliberately static — no data, no
 * calls, nothing gated — because it must render for someone who has not yet
 * proved they may see anything.
 *
 * **It carries no credential and no deployment URL.** Pressing the button
 * navigates to the application, the gate refuses, and the browser asks. That is
 * the whole of the login: one prompt, from the credential supplied with the
 * link.
 */

export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>TTB Label Check — prototype</title>
<style>
  :root {
    --ink: #16161d; --muted: #5b5b66; --rule: #dcdcdc;
    --accent: #1a4480; --panel: #f6f7f9;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 24px 72px;
    font: 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: var(--ink); background: #fff;
  }
  main { max-width: 44rem; margin: 0 auto; }
  h1 { font-size: 30px; margin: 0 0 6px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); margin: 0 0 32px; font-size: 18px; }
  h2 { font-size: 19px; margin: 36px 0 10px; }
  p { max-width: 62ch; }
  .lede { font-size: 18px; }
  .panel {
    background: var(--panel); border: 1px solid var(--rule);
    border-radius: 8px; padding: 20px 22px; margin: 28px 0;
  }
  ol { padding-left: 20px; } li { margin: 8px 0; max-width: 60ch; }
  .go {
    display: inline-block; margin-top: 8px; padding: 14px 26px;
    background: var(--accent); color: #fff; text-decoration: none;
    border-radius: 6px; font-size: 18px; font-weight: 600;
  }
  .go:focus-visible { outline: 3px solid #b45309; outline-offset: 3px; }
  .note { color: var(--muted); font-size: 15px; }
  table { border-collapse: collapse; margin: 12px 0; width: 100%; }
  td, th { border-bottom: 1px solid var(--rule); padding: 8px 10px; text-align: left; vertical-align: top; }
  th { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  code { background: var(--panel); padding: 1px 5px; border-radius: 3px; font-size: 15px; }
  footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--rule); }
</style>
</head>
<body>
<main>
  <h1>TTB Label Check</h1>
  <p class="sub">A prototype: checking an alcohol beverage label against the application it was filed with.</p>

  <p class="lede">An agent uploads a completed TTB F 5100.31. The label artwork and
  the application record are read as two separate, independent readings, compared
  field by field, and the health warning is checked word for word against
  27 CFR 16.21. It returns findings, each with its citation and the evidence
  behind it.</p>

  <p><strong>The determination stays with the compliance agent.</strong> This
  assembles the evidence for one and records what was decided.</p>

  <div class="panel">
    <h2 style="margin-top:0">The five seconds, and how they are met</h2>
    <p>The requirement came from a vendor pilot that took 30–40 seconds
    <em>while an agent sat waiting</em> — so the agents went back to checking by
    eye. The answer here is not a faster model. Filings are checked <strong>as
    they arrive</strong>, so an agent opens a worklist of recommendations that
    are already prepared and never waits for inference at all.</p>
    <p class="note">Single review exists for the case an agent has in front of
    them right now. There a person really is waiting, and there the five seconds
    apply literally.</p>
    <p class="note">The rule behind it: <strong>what a person waits for is kept
    separate from what the pipeline does.</strong> The checking will get longer —
    more regulations, a second opinion, a model that retrieves the passage a
    finding rests on — and none of that may land on the path where somebody is
    waiting. A tool that gets more thorough and slower with each release is
    abandoned for the same reason the last one was.</p>
  </div>

  <h2>What to look at, in order</h2>
  <ol>
    <li><strong>Single review</strong> — download a demo example and upload it.
    Start with <em>Fully compliant</em>, then <em>Alcohol content genuinely
    differs</em>. Each field shows what the label said beside what the
    application said.</li>
    <li><strong>Batch</strong> — runs 26 bundled submissions and streams results
    as they settle. This is the path that scales: nobody is waiting for it.</li>
    <li><strong>Policy</strong> — the rules in force, from when, and who approved
    each. A rule takes effect by a reviewed change to a file, not a button.</li>
    <li><strong>Agents</strong> — who and what may act here. The model reads; the
    rules compare; only a person decides, and the code refuses the rest.</li>
    <li><strong>Audit</strong> — take a decided record, re-derive its verdict
    from the stored evidence, put the filing back to the model, and record what
    you conclude.</li>
    <li><strong>Measurement</strong> — what it cost and how long it took, from
    the system's own record rather than a claim.</li>
  </ol>

  <h2>What it is honest about</h2>
  <table>
    <tr><th>Claim</th><th>What is actually true</th></tr>
    <tr><td>Deterministic AI</td><td>No. Perception is non-deterministic; the reading is recorded, and every judgement drawn from it is reproducible</td></tr>
    <tr><td>Accuracy</td><td>No percentage is claimed. The corpus is synthetic and was authored alongside the system</td></tr>
    <tr><td>Who decided</td><td>Names are declared, not verified. This prototype authenticates nobody</td></tr>
  </table>

  <div class="panel">
    <h2 style="margin-top:0">Opening the prototype</h2>
    <p>It asks for a username and password. That is a <strong>cost
    control</strong>, not a login: reading one label calls a metered inference
    API, so an open address is an unbounded bill. The credential came with the
    link to this page.</p>
    <p><a class="go" href="/app">Open the prototype</a></p>
    <p class="note">Your browser will ask for the credential once.</p>
  </div>

  <footer>
    <p class="note">Source, design documents and the decision record accompany
    this deployment. The design was worked before the code and is the
    specification rather than background.</p>
  </footer>
</main>
</body>
</html>
`
