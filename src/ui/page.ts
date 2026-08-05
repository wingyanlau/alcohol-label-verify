/**
 * The batch interface — a single self-contained page.
 *
 * Design reference: ui-design §5–§12.
 *
 * One HTML document, no build step, no external assets. It speaks to three
 * endpoints: POST /batch to start, a WebSocket for live progress, and a fetch
 * per row for the full result. The verdict vocabulary never reaches the screen
 * (§12) — "Everything matches", not CLEAR; "could not read", not UNREADABLE;
 * and the word "AI" appears nowhere, because the agent is checking a label, not
 * operating a model.
 *
 * Values read from a label are inserted with textContent and DOM construction,
 * never as HTML — a label carrying injected markup (the L13 case) can change no
 * pixel of this page.
 */

/*
 * The product-type dropdown, and the list that fed it, are gone.
 *
 * Product type is the input rule selection runs on (D25), and the form an agent
 * was copying it from is the one they now upload. Asking for it as well would
 * be a question whose answer the system already has, with nothing to say which
 * of the two selected the rules when they disagreed.
 */

export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Label check</title>
<style>
  :root {
    --ink: #1a1a1a; --muted: #565656; --line: #d6d6d6; --bg: #fbfbfa; --panel: #ffffff;
    --ok: #1a7f37; --bad: #b3261e; --warn: #8a6100; --focus: #0b57d0;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 17px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  main { max-width: 1000px; margin: 0 auto; padding: 32px 24px 96px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 20px; margin: 28px 0 12px; }
  p.lede { color: var(--muted); margin: 0 0 24px; max-width: 68ch; }
  .note { color: var(--muted); font-size: 15px; max-width: 68ch; }
  .samples { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--rule, #dcdcdc); }
  .samples h3 { font-size: 15px; margin: 0 0 4px; }
  .samplelist { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
  .sample { display: flex; gap: 12px; align-items: baseline; }
  .sample a { font-weight: 600; white-space: nowrap; }
  .sample .what { color: var(--muted); font-size: 14px; max-width: 60ch; }
  /* Not an error — nothing failed. It is the absence of a check, which reads
     as a pass unless it is given weight of its own. */
  .warn-note { color: var(--warn-ink, #8a5a00); font-size: 15px; max-width: 68ch; font-weight: 600; }
  button {
    font: inherit; cursor: pointer; border: 1px solid var(--ink); background: var(--ink);
    color: #fff; padding: 12px 20px; border-radius: 6px;
  }
  button.secondary { background: var(--panel); color: var(--ink); }
  button:focus-visible, a:focus-visible, li[tabindex]:focus-visible {
    outline: 3px solid var(--focus); outline-offset: 2px;
  }
  button[disabled] { opacity: .55; cursor: default; }
  .hidden { display: none !important; }

  .progress-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
  .bar { height: 12px; background: #ececeb; border-radius: 6px; overflow: hidden; margin: 10px 0 18px; }
  .bar > span { display: block; height: 100%; background: var(--focus); width: 0; transition: width .3s; }
  .counts { display: flex; flex-wrap: wrap; gap: 10px 22px; margin-bottom: 18px; }
  .count { display: inline-flex; align-items: center; gap: 8px; font-size: 16px; }
  .count b { font-variant-numeric: tabular-nums; }
  .dot { font-weight: 700; }
  .ok  { color: var(--ok); } .bad { color: var(--bad); } .warn { color: var(--warn); }

  ul.worklist { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
  ul.worklist li { display: grid; grid-template-columns: 28px 1fr auto; gap: 12px; align-items: center;
    padding: 12px 16px; border-top: 1px solid var(--line); cursor: pointer; }
  ul.worklist li:first-child { border-top: none; }
  ul.worklist li:hover { background: #f5f7fb; }
  .status-icon { font-weight: 700; font-size: 18px; text-align: center; }
  .row-name { font-weight: 600; }
  .row-summary { color: var(--muted); font-size: 15px; }
  .row-state { color: var(--muted); font-size: 14px; justify-self: end; }
  .divider { padding: 6px 16px; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); background: #f3f3f2; border-top: 1px solid var(--line); }

  /* Detail overlay */
  .overlay { position: fixed; inset: 0; background: rgba(20,20,20,.5); display: flex; justify-content: center; align-items: flex-start; padding: 24px; overflow: auto; }
  .sheet { background: var(--panel); max-width: 900px; width: 100%; border-radius: 10px; padding: 24px 28px 32px; box-shadow: 0 10px 40px rgba(0,0,0,.25); }
  .sheet-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 8px; }
  .sheet-head .file { color: var(--muted); font-size: 15px; }
  .outcome { display: flex; gap: 12px; align-items: flex-start; padding: 16px; border-radius: 8px; border: 1px solid var(--line); margin: 8px 0 20px; }
  .outcome .big { font-size: 22px; font-weight: 700; }
  .outcome.ok { background: #eaf6ec; border-color: #bfe3c6; }
  .outcome.bad { background: #fdecea; border-color: #f4c7c3; }
  .outcome.warn { background: #fdf6e3; border-color: #ecdca6; }
  .layout { display: grid; grid-template-columns: 1fr 300px; gap: 24px; }
  @media (max-width: 820px) { .layout { grid-template-columns: 1fr; } }
  .field { border-top: 1px solid var(--line); padding: 14px 0; }
  .field:first-child { border-top: none; }
  .field .fname { font-weight: 600; }
  .field .fstatus { margin: 4px 0; font-weight: 600; }
  .field .vals { font-size: 16px; }
  .field .vals div { display: flex; gap: 8px; }
  .field .vals .k { color: var(--muted); min-width: 92px; }
  .field .rule { color: var(--muted); font-size: 15px; margin-top: 4px; font-style: italic; }
  .imgpanel img { max-width: 100%; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  .imgpanel .pdf { width: 100%; height: 460px; margin-top: 14px; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  .imgpanel .cap { color: var(--muted); font-size: 14px; margin-top: 6px; }
  /* A stated policy, not a missing panel. Neutral grey, deliberately: a
     deletion that happened on schedule is not a warning. */
  .purged { color: var(--muted); font-size: 15px; border: 1px dashed var(--line);
            border-radius: 6px; padding: 14px; background: #f7f7f6; }
  /* The quotable reference (D21). Muted — it is provenance, not a finding —
     but never below 15px, and monospaced so 0/O and 1/I are distinguishable
     on screen as well as in the alphabet the code is drawn from. */
  .refline { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--line);
             color: var(--muted); font-size: 15px; }
  .refcode { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
             font-size: 16px; letter-spacing: 0.06em; color: var(--ink);
             user-select: all; }
  .decision { border-top: 1px solid var(--line); margin-top: 20px; padding-top: 14px; }
  .decision input, .decision textarea { width: 100%; margin-bottom: 8px; }
  .decision-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  /* A row somebody has already dealt with. Dimmed rather than hidden: it is
     still part of the batch, and an agent may want to revisit it — the mark
     exists to stop them opening it by accident, not to take it away. */
  #worklist li.done { opacity: 0.62; }
  .row-decided { grid-column: 2; font-size: 14px; color: var(--muted); margin-top: 2px; }
  .warning-seg { padding: 8px 0; }
  .warning-seg .dev { color: var(--muted); font-size: 15px; }
  /* The recommendation sits under the headline in the outcome banner. Normal
     weight against the headline's bold: it is advice, and it should not
     compete with the finding it follows. */
  .outcome .recommend { font-size: 16px; margin-top: 4px; }
  .finding { border-top: 1px solid var(--line); padding: 12px 0; }
  .finding .fstatus { font-weight: 600; }
  .finding .freq { margin-top: 2px; }
  .finding .dev { color: var(--muted); font-size: 15px; margin-top: 2px; }
  /* Citation and rule id. Monospaced for the same reason as the reference
     code: it is meant to be read across to a regulation, character by
     character. */
  .finding .rule { color: var(--muted); font-size: 14px; margin-top: 4px;
                   font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .advisory { border-top: 1px solid var(--line); margin-top: 16px; padding-top: 14px; }
  .advisory label { display: flex; gap: 10px; align-items: flex-start; padding: 5px 0; }
  .banner { background: #fdf6e3; border: 1px solid #ecdca6; border-radius: 6px; padding: 10px 14px; font-size: 15px; color: var(--warn); margin-bottom: 16px; }
  .err { color: var(--bad); margin-top: 12px; }

  /* Single review (§4). */
  .topbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
  .nav { display: flex; align-items: center; gap: 26px; flex-wrap: wrap; }
  /* The work: a real tab strip, selected by an underline rather than by being
     the only filled button in a row. A tab says "you are here"; a button says
     "press me", and three buttons said it three times at once. */
  .modes { display: flex; gap: 4px; }
  .mode { padding: 9px 16px; font-size: 16px; background: none; color: var(--muted);
          border: 0; border-bottom: 3px solid transparent; border-radius: 0; font-weight: 600; }
  .mode:hover { color: var(--ink); }
  .mode[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--accent, #1a4480); }
  /* Reference, and quieter by a clear margin — read occasionally, never in the
     middle of checking a label. */
  .refs { display: flex; gap: 14px; padding-left: 26px; border-left: 1px solid var(--rule, #dcdcdc); }
  .ref { background: none; border: 0; padding: 6px 2px; font-size: 15px; color: var(--muted);
         text-decoration: underline; text-underline-offset: 4px; border-radius: 0; }
  .ref:hover { color: var(--ink); }
  .ref[aria-selected="true"] { color: var(--ink); font-weight: 600; }
  @media (max-width: 720px) {
    .nav { gap: 12px; }
    .refs { padding-left: 0; border-left: 0; }
  }
  .layout2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 20px; }
  @media (max-width: 820px) { .layout2 { grid-template-columns: 1fr; } }
  .panel { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 20px 22px; }
  .panel h2 { margin: 0 0 16px; font-size: 18px; }
  .fieldrow { margin-bottom: 16px; }
  /* Labels sit ABOVE inputs, never inside them: placeholder-as-label
     disappears on focus and strands a hesitant user mid-form (§4.2). */
  .fieldrow label { display: block; font-weight: 600; margin-bottom: 6px; }
  .fieldrow input { width: 100%; font: inherit; padding: 10px 12px; border: 1px solid var(--line);
                    border-radius: 6px; background: #fff; color: var(--ink); }
  .fieldrow input:focus-visible { outline: 3px solid var(--focus); outline-offset: 1px; }
  .fieldrow input[aria-invalid="true"] { border-color: var(--bad); }
  .req { color: var(--muted); font-weight: 400; }
  .hint { color: var(--muted); font-size: 15px; margin: 6px 0 0; }
  .inline-err { color: var(--bad); font-size: 15px; margin: 6px 0 0; }
  .suffixed { position: relative; }
  /* The % is an adornment inside the border, not part of the value (§4.2). */
  .suffix { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); }
  .suffixed input { padding-right: 32px; }
  .drop { border: 2px dashed var(--line); border-radius: 8px; padding: 28px 20px; text-align: center; }
  .drop.over { border-style: solid; border-color: var(--focus); background: #f5f7fb; }
  .dropmsg { margin: 0 0 14px; color: var(--muted); }
  .constraint { color: var(--muted); font-size: 15px; margin: 14px 0 0; }
  .picked { display: flex; gap: 14px; align-items: flex-start; }
  .picked img { width: 120px; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  .pickactions { display: flex; gap: 8px; margin-top: 8px; }
  .pickactions button { padding: 6px 12px; font-size: 15px; }
  .primary-row { margin-top: 24px; text-align: center;
                 display: flex; gap: 12px; justify-content: center; align-items: center;
                 flex-wrap: wrap; }
  .primary-row button { font-size: 19px; padding: 14px 28px; }
  /* The clear button is the lesser of the two and is sized to say so. Matching
     the primary would make "start again" look like an equal choice to "check
     this label", which is not what an agent came here to do. */
  .primary-row button.secondary { font-size: 17px; padding: 12px 20px; }
  @media (max-width: 820px) { .primary-row button { width: 100%; } }
</style>
</head>
<body>
<main>
  <!-- Region A: product name and the mode switch, and no other chrome (§4.1). -->
  <div class="topbar">
    <h1>TTB Label Check</h1>
    <!-- Two groups, because there are two kinds of thing here (§4.1).
         "Single review" and "Batch" are the work: an agent is in one or the
         other all day. "Policy" and "Agents" are reference — what the system
         is governed by and who may act — read occasionally, and never in the
         middle of checking a label. Four equal buttons in a row made the
         choice look like four equal jobs, and pushed the two that matter into
         a line of chrome. -->
    <div class="nav">
      <div class="modes" role="tablist" aria-label="What to check">
        <button id="modeBatch" type="button" class="mode" role="tab" aria-selected="true">Batch</button>
        <button id="modeSingle" type="button" class="mode" role="tab" aria-selected="false">Single review</button>
      </div>
      <div class="refs" role="tablist" aria-label="How this system is governed">
        <button id="modeAudit" type="button" class="ref" role="tab" aria-selected="false">Audit</button>
        <button id="modeMeasure" type="button" class="ref" role="tab" aria-selected="false">Measurement</button>
        <button id="modeAgents" type="button" class="ref" role="tab" aria-selected="false">Agents</button>
        <button id="modePolicy" type="button" class="ref" role="tab" aria-selected="false">Policy</button>
      </div>
    </div>
  </div>

  <!-- The policy archive, read only (ui-design §2.3).
       A rule is enacted by approving it in config/policy-set.json, which is
       the reviewed source (D45). Nothing here writes; a button that did would
       make the rows authored, and the next reconciliation would supersede it. -->
  <section id="policy" class="hidden">
    <h1>Policy</h1>
    <p class="lede">The rules this system applies, and where each came from. Read only —
      a rule takes effect when it is approved in the reviewed policy file.</p>
    <div id="policyBody"></div>
  </section>

  <!-- Who and what may act here (§19, D46). Read only, like the policy view:
       the register is config, reviewed like everything else, and a control
       here that wrote would be a control with no gate behind it (D14). -->
  <section id="agents" class="hidden">
    <h1>Agents</h1>
    <p class="lede">Everyone and everything this deployment recognises, and what each may do.
      The model reads, the rules compare, the human decides — and the code refuses the rest.</p>
    <div id="agentsBody"></div>
  </section>

  <!-- Auditing the record: has the history been altered, and do the verdicts
       still hold (NFR-13)?
       Named for the act rather than the noun. "Record" could mean the audit
       trail, one submission's record, or the act of recording; a reader comes
       here to CHECK something, and the endpoints behind it are /audit/*. -->
  <section id="audit" class="hidden">
    <h1>Audit</h1>
    <p class="lede">Two checks, run now against everything this deployment holds: whether the recorded
      history has been altered, and whether every verdict still follows from the reading that produced it.</p>
    <div id="auditBody"></div>
  </section>

  <!-- What this deployment has done, and what it cost (§16, D52). Read only.
       §16 opens by saying a criterion without a measurement is an intention
       rather than a claim; S1 went unmeasured by the product itself until
       this. -->
  <section id="measure" class="hidden">
    <h1>Measurement</h1>
    <p class="lede">What this deployment has actually done, taken from the record rather than from a log.
      Nothing here counts a person: reads, models, durations and tokens.</p>
    <div id="measureBody"></div>
  </section>

  <!-- Single review (§4). One submission, checked now — and the same input the
       batch takes. The agent used to type the application data beside the
       artwork; the form they were copying from is the filed PDF, so the screen
       now reads it instead. A transcription step was never part of the job, and
       every value typed was a value that could be mistyped into a discrepancy
       nobody could explain. -->
  <section id="single">
    <div class="panel">
      <h2>The filed application</h2>
      <p class="hint">The completed TTB F 5100.31 as a PDF — the label artwork and the application record, exactly as filed. Both pages are read separately: neither reading is shown the other.</p>
      <!-- Drag-and-drop is never the only affordance: the button is the
           primary one, the drop zone a convenience (§4.3). -->
      <div id="drop" class="drop">
        <p class="dropmsg">Drop the filed application here</p>
        <button id="pickBtn" type="button" class="secondary">Choose a file</button>
        <p class="constraint">PDF, up to 10 MB</p>
        <input id="file" type="file" accept="application/pdf" class="hidden">
      </div>
      <div id="picked" class="picked hidden">
        <div>
          <div id="pickedName" class="row-name"></div>
          <div id="pickedSize" class="row-summary"></div>
          <div class="pickactions">
            <button id="replaceBtn" type="button" class="secondary">Replace</button>
            <button id="removeBtn" type="button" class="secondary">Remove</button>
          </div>
        </div>
      </div>
      <p class="inline-err hidden" id="fileErr"></p>

      <!-- For somebody with no TTB filing to hand — a reviewer looking at this
           deployment, or anyone who wants to see what a discrepancy looks like
           before trusting a screen that reports one. These are the corpus
           files, not mock-ups: the same documents the batch runs on, each with
           authored ground truth for what it should produce. -->
      <div class="samples">
        <h3>Demo examples</h3>
        <p class="hint">Download one of these and upload it above to test out the demo. Each is a complete submission — the
          <a href="https://www.ttb.gov/system/files/images/pdfs/forms/f510031.pdf" rel="noopener noreferrer" target="_blank">TTB F 5100.31</a>
          with the labels affixed, and the application record it is checked against.</p>
        <div id="sampleList" class="samplelist"></div>
      </div>
    </div>

    <!-- Never disabled (§4.4). A disabled button is unfocusable, announces
         nothing, and gives a hesitant person no reason for the silence.
         Pressing it with nothing attached runs validation and moves focus to
         the problem, which tells them what to do. -->
    <div class="primary-row">
      <button id="checkBtn" type="button">Check this submission</button>
      <p id="working" class="note hidden" role="status" aria-live="polite"></p>
    </div>
    <div id="singleResult"></div>
  </section>

  <section id="batchHome" class="hidden">
  <h1>Label check</h1>
  <p class="lede">Check each submission's label artwork against its application record, and verify the government health warning. This produces evidence for review — it does not approve or reject.</p>

  <section id="start">
    <button id="startBtn" type="button">Check the 26 test submissions</button>
    <button id="resetBtn" type="button" class="secondary hidden" style="margin-left:10px">Stop and reset</button>
    <p class="note" style="margin-top:14px">Runs the bundled corpus: 26 authored submissions covering matches, genuine discrepancies, unreadable fields, and the health-warning cases. Results appear below as each one finishes.</p>
    <p id="startErr" class="err hidden" role="alert"></p>
  </section>

  <section id="batch" class="hidden" aria-label="Batch progress">
    <div class="progress-head">
      <h2 id="progressLabel" style="margin:0">Checked 0 of 0</h2>
    </div>
    <div class="bar"><span id="bar"></span></div>
    <div class="counts" id="counts" role="status" aria-live="polite"></div>
    <ul class="worklist" id="worklist"></ul>
  </section>

  </section>

  <div id="detail" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="detailTitle"></div>
</main>
<script>
(function () {
  'use strict'
  var startBtn = document.getElementById('startBtn')
  var startErr = document.getElementById('startErr')
  var resetBtn = document.getElementById('resetBtn')
  var batchSection = document.getElementById('batch')
  var progressLabel = document.getElementById('progressLabel')
  var bar = document.getElementById('bar')
  var counts = document.getElementById('counts')
  var worklist = document.getElementById('worklist')
  var detail = document.getElementById('detail')

  var jobId = null
  var total = 0
  var rows = new Map()
  // What a person has already decided, by submission. The coordinator does not
  // know — a decision happens after the work, in D1 — so it is fetched
  // alongside and merged for display only.
  var decided = {}
  var lastFocused = null
  // The live stream, held so a reconnect can replace it rather than stack on
  // top of it — and so a replaced socket can tell it is no longer the one.
  var ws = null

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  // Outcome -> presentation. The internal vocabulary stops here (ui-design §12).
  function present(row) {
    if (row.state === 'FAILED' || row.state === 'REJECTED') {
      return { icon: 'x', cls: 'warn', words: 'Could not process', rank: 4 }
    }
    if (row.state === 'QUEUED') return { icon: '…', cls: 'muted', words: 'Waiting', rank: 7 }
    if (row.state === 'RUNNING') return { icon: '•', cls: 'muted', words: 'Checking…', rank: 6 }
    switch (row.outcome) {
      // Settled first, trouble last.
      //
      // This is the reverse of how it read until now, and the reversal is
      // deliberate rather than a drift: an agent working a batch clears the
      // ones that need nothing, then spends the remaining time on the ones that
      // do. Leading with problems put the longest work at the top of a list
      // somebody was trying to get through.
      //
      // Nothing is hidden either way — both groups are on the same page, under
      // a divider that says which is which.
      case 'CLEAR': return { icon: '✓', cls: 'ok', words: 'Everything matches', rank: 0 }
      case 'CLEAR_CONFIRM_FLAGGED': return { icon: '✓', cls: 'ok', words: 'Matches — confirm flagged', rank: 1 }
      // Below the divider: a rule this system may not decide is work, not a
      // clean pass (D40).
      case 'CLEAR_CONFIRM_POLICY': return { icon: '?', cls: 'warn', words: 'Needs your judgement', rank: 2 }
      case 'INCOMPLETE': return { icon: '!', cls: 'warn', words: 'Could not finish the check', rank: 3 }
      case 'DISCREPANCIES_FOUND': return { icon: '✗', cls: 'bad', words: 'Problems found', rank: 5 }
      default: return { icon: '•', cls: 'muted', words: 'Checking…', rank: 6 }
    }
  }

  // The button reflects the job, not this tab. A session that merely joined a
  // running batch must not offer to start another one.
  function setButton(mode) {
    // Shown whenever a job exists, running or not. Offering it only during a
    // fault makes it a control nobody knows about until they are already
    // stuck; and clearing a settled run before starting fresh is a reasonable
    // thing to want. The label says which of the two it is about to do.
    resetBtn.classList.remove('hidden')
    resetBtn.textContent = mode === 'running' ? 'Stop and reset' : 'Clear results'
    if (mode === 'running') {
      startBtn.disabled = true
      startBtn.textContent = 'Checking…'
    } else if (mode === 'rerun') {
      startBtn.disabled = false
      startBtn.textContent = 'Check the 26 test submissions again'
    } else {
      startBtn.disabled = false
      startBtn.textContent = 'Check the 26 test submissions'
    }
  }

  function renderProgress(progress) {
    total = progress.total
    var done = progress.completed + progress.failed
    progressLabel.textContent = 'Checked ' + done + ' of ' + total
    bar.style.width = total ? Math.round((done / total) * 100) + '%' : '0%'
    // progress.done is the ledger's own judgement that nothing remains —
    // including a batch where every item failed, which is finished rather
    // than waiting.
    setButton(progress.done ? 'rerun' : 'running')
  }

  function renderCounts() {
    var problems = 0, unread = 0, judgement = 0, matched = 0, failed = 0
    rows.forEach(function (r) {
      if (r.state === 'FAILED' || r.state === 'REJECTED') { failed++; return }
      if (r.outcome === 'DISCREPANCIES_FOUND') problems++
      else if (r.outcome === 'INCOMPLETE') unread++
      // Its own count, not folded into "matched". Nothing blocking was found,
      // but a rule is still open, and a chip saying "matched" would close it on
      // the agent's behalf.
      else if (r.outcome === 'CLEAR_CONFIRM_POLICY') judgement++
      else if (r.outcome === 'CLEAR' || r.outcome === 'CLEAR_CONFIRM_FLAGGED') matched++
    })
    counts.textContent = ''
    function chip(cls, icon, n, label) {
      var c = el('span', 'count')
      c.appendChild(el('span', 'dot ' + cls, icon))
      var b = el('b', null, String(n)); c.appendChild(b)
      c.appendChild(document.createTextNode(' ' + label))
      return c
    }
    counts.appendChild(chip('bad', '✗', problems, 'with problems'))
    counts.appendChild(chip('warn', '!', unread, 'could not be read'))
    if (judgement) counts.appendChild(chip('warn', '?', judgement, 'need your judgement'))
    if (failed) counts.appendChild(chip('warn', '✗', failed, 'could not be processed'))
    counts.appendChild(chip('ok', '✓', matched, 'matched'))
  }

  function renderWorklist() {
    var items = Array.from(rows.values())
    items.sort(function (a, b) {
      var pa = present(a), pb = present(b)
      if (pa.rank !== pb.rank) return pa.rank - pb.rank
      return a.sourceName < b.sourceName ? -1 : 1
    })
    worklist.textContent = ''
    var dividerShown = false
    items.forEach(function (r) {
      var p = present(r)
      // A single divider separates things needing attention from clean passes.
      if (!dividerShown && p.rank >= 2) {
        var d = el('li', 'divider', 'Needs your attention')
        d.style.cursor = 'default'; d.removeAttribute('tabindex')
        worklist.appendChild(d); dividerShown = true
      }
      var li = el('li')
      li.tabIndex = 0
      li.setAttribute('role', 'button')
      li.appendChild(el('span', 'status-icon ' + p.cls, p.icon))
      var mid = el('div')
      mid.appendChild(el('div', 'row-name', r.sourceName))
      mid.appendChild(el('div', 'row-summary', r.summary || r.cause || p.words))
      li.appendChild(mid)
      li.appendChild(el('div', 'row-state', p.words))

      // Whether a person has already dealt with this one. The point is not to
      // show the decision — that is on the detail screen — but to save an agent
      // opening a row they have already judged, which on a batch of 26 is the
      // difference between finishing and starting again.
      var seen = decided[r.itemId]
      if (seen) {
        var mark = el('div', 'row-decided')
        mark.textContent = (seen.decision === 'APPROVED' ? '✓ ' : seen.decision === 'REJECTED' ? '✗ ' : '↩ ') +
          seen.decision.charAt(0) + seen.decision.slice(1).toLowerCase() + ' by ' + seen.decidedBy
        li.appendChild(mark)
        li.classList.add('done')
      }
      var open = function () { openDetail(r.itemId, r.sourceName) }
      li.addEventListener('click', open)
      li.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
      })
      worklist.appendChild(li)
    })
  }

  function upsert(item) {
    rows.set(item.itemId, item)
  }

  function handleEvent(msg) {
    if (msg.type === 'snapshot') {
      rows.clear()
      msg.snapshot.items.forEach(upsert)
      renderProgress(msg.snapshot.progress)
    } else if (msg.type === 'item.started') {
      var r = rows.get(msg.itemId); if (r) r.state = 'RUNNING'
      renderProgress(msg.progress)
    } else if (msg.type === 'item.deferred') {
      // Held for a backoff: waiting again, not still being checked.
      var q = rows.get(msg.itemId); if (q) q.state = 'QUEUED'
      renderProgress(msg.progress)
    } else if (msg.type === 'item.completed' || msg.type === 'item.failed') {
      upsert(msg.item)
      renderProgress(msg.progress)
    } else if (msg.type === 'job.completed') {
      renderProgress(msg.progress)
    } else if (msg.type === 'job.aborted') {
      // Stopped for a reason none of the remaining items could have changed.
      // Said once, plainly, rather than left to be inferred from a worklist
      // full of identical failures.
      startErr.textContent = msg.reason
      startErr.classList.remove('hidden')
      renderProgress(msg.progress)
    }
    renderCounts()
    renderWorklist()
    loadDecided()
  }

  /**
   * Which rows have already been dealt with.
   *
   * Best effort: a worklist that cannot say whether something was decided is
   * still a usable worklist, so a failure here leaves the marks off rather than
   * breaking the screen.
   */
  function loadDecided() {
    if (!jobId) return
    fetch('/batch/' + jobId + '/decisions')
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (d) {
        if (!d || !d.decided) return
        decided = d.decided
        renderWorklist()
      })
      .catch(function () { /* leave the rows unmarked */ })
  }

  function connect() {
    // Replace any existing socket rather than stacking another on top. The
    // coordinator sends its snapshot on connect, so reconnecting is also how
    // the page asks "what is true now" after an action that may have changed
    // it — see reconcile().
    if (ws) { var previous = ws; ws = null; try { previous.close() } catch (e) { /* already gone */ } }
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    var sock = new WebSocket(proto + '//' + location.host + '/batch/' + jobId + '/stream')
    ws = sock
    sock.addEventListener('message', function (e) {
      try { handleEvent(JSON.parse(e.data)) } catch (err) { /* ignore malformed frame */ }
    })
    sock.addEventListener('close', function () {
      // A closed lid must not lose a job (B7): reconnect and take a fresh
      // snapshot. Only the live socket may do so — one that has been replaced
      // must not resurrect itself and deliver a snapshot for a job the page
      // has already moved on from.
      if (ws === sock) setTimeout(connect, 1500)
    })
  }

  /**
   * Ask the service what is true, and make the page agree with it.
   *
   * The page used to infer this from startBtn.disabled — a button, which is
   * also disabled while a start is merely in flight — and then wait for an
   * abort broadcast to put things right. A settled job has nothing to
   * broadcast, so the page waited forever: start disabled reading "Checking…",
   * an empty worklist, and no way back except a reload.
   *
   * The service knows whether a job exists and whether it is running. Asking it
   * is both shorter and correct whatever state the click happened to interrupt.
   */
  function reconcile() {
    return fetch('/batch/current')
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (data) {
        if (!data || !data.jobId) {
          rows.clear()
          renderCounts(); renderWorklist()
          batchSection.classList.add('hidden')
          resetBtn.classList.add('hidden')
          setButton('idle')
          return
        }
        jobId = data.jobId
        batchSection.classList.remove('hidden')
        setButton(data.running ? 'running' : 'rerun')
        // Reconnect for a fresh snapshot: the rows in memory may be stale or,
        // as after a reset, absent entirely while the job still has every one
        // of its items.
        connect()
      })
      .catch(function () {
        // Never leave the page unable to act. If the service cannot be
        // reached, the state an agent can retry from is the safe one.
        setButton('idle')
      })
  }

  startBtn.addEventListener('click', function () {
    startBtn.disabled = true
    startBtn.textContent = 'Starting…'
    startErr.classList.add('hidden')
    // Clear the previous run NOW, before the request goes out.
    //
    // Reported from staging: pressing this again left 26 finished rows, their
    // counts and a full progress bar on screen while the new job was being
    // created. Nothing changes until the first snapshot arrives, so every
    // visible signal said the batch was finished and the only one saying
    // otherwise was a word on a button — which reads as stuck, not as starting.
    //
    // The old rows are not merely stale, either. They belong to a job the agent
    // has just stopped looking at, and a progress bar that says "Checked 26 of
    // 26" over a run that has checked nothing is the screen contradicting
    // itself. An empty list under a zeroed bar is both honest and legible as
    // work beginning.
    rows.clear()
    total = 0
    renderCounts()
    renderWorklist()
    progressLabel.textContent = 'Checked 0 of 0'
    bar.style.width = '0%'
    batchSection.classList.remove('hidden')
    // The server returns the job in flight if there is one, so this is a join
    // rather than a second batch. Nothing here needs to distinguish them.
    fetch('/batch', { method: 'POST' })
      // The body is read whether or not the request succeeded. The server puts
      // the actual cause in "detail", and throwing the response away meant an
      // agent — and whoever they reported it to — got a sentence that named
      // nothing. An error must say what was observed (D38).
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) {
            var e = new Error((body && (body.detail || body.reason)) || 'start failed')
            throw e
          }
          return body
        })
      })
      .then(function (data) {
        jobId = data.jobId
        batchSection.classList.remove('hidden')
        setButton('running')
        connect()
      })
      .catch(function (err) {
        setButton('idle')
        // The sentence an agent can act on, followed by what actually failed.
        // The first half is for them; the second is for whoever they tell.
        var said = err && err.message && err.message !== 'start failed' ? err.message : ''
        startErr.textContent =
          'The check could not be started. Nothing was saved. Please try again in a moment.' +
          (said ? ' (' + said + ')' : '')
        startErr.classList.remove('hidden')
        // Clearing on click promised a new run. If there is not one, the page
        // must not be left blank: the earlier job still exists and the agent
        // has just lost sight of it. Ask the service what is true rather than
        // restoring rows from memory that may no longer be what it holds.
        reconcile()
      })
  })

  resetBtn.addEventListener('click', function () {
    var wasRunning = startBtn.disabled
    resetBtn.disabled = true
    resetBtn.textContent = wasRunning ? 'Stopping…' : 'Clearing…'
    fetch('/batch/reset', { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('reset failed'); return r.json() })
      .then(function (body) {
        resetBtn.disabled = false
        // Whether anything was actually stopped is the server's answer, not a
        // guess from a button. A null jobId means the job had already settled
        // — the case that used to wedge the page, because it then waited for
        // an abort broadcast that a settled coordinator never sends.
        if (body && body.jobId === null) {
          // Nothing to reset. Go straight to a state the agent can act from.
          rows.clear()
          renderCounts(); renderWorklist()
          batchSection.classList.add('hidden')
          resetBtn.classList.add('hidden')
          setButton('idle')
          return
        }
        return reconcile()
      })
      .catch(function () {
        resetBtn.disabled = false
        resetBtn.textContent = wasRunning ? 'Stop and reset' : 'Clear results'
        startErr.textContent = 'The check could not be stopped. Please try again in a moment.'
        startErr.classList.remove('hidden')
      })
  })

  // Adopt whatever the service is already doing. A batch belongs to the
  // service, not to the tab that started it: reloading, or arriving late,
  // shows the same worklist everyone else is looking at. The coordinator
  // sends a full snapshot on connect, so the job id is all this needs.
  function bootstrap() {
    fetch('/batch/current')
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (data) {
        if (!data || !data.jobId) return
        jobId = data.jobId
        batchSection.classList.remove('hidden')
        // A job in flight is the one case where the batch screen matters more
        // than the single-review form: everyone watching must see the same
        // thing, which is the whole point of adopting the job at all.
        if (data.running) { setButton('running'); showMode('batch') }
        connect()
      })
      .catch(function () { /* no current job to adopt; the button stands */ })
  }

  bootstrap()

  // The worklist is the landing screen, because it is what an agent arrives to.
  //
  // Single review used to be, on the reasoning that it is the interactive path
  // and batch is the demonstration. That had it backwards: filings are checked
  // as they arrive, so the ordinary start of a shift is a queue of prepared
  // work, and single review is the exception — one case an agent has in front
  // of them right now. Opening on the exception told the wrong story about how
  // the five-second requirement is met.
  // Four screens now, so the argument is a name rather than a boolean — it was
  // showMode(true|false), which stopped being able to say which screen the
  // moment there were more than two.
  var SCREENS = [
    { mode: 'batch', section: 'batchHome', tab: 'modeBatch' },
    { mode: 'single', section: 'single', tab: 'modeSingle' },
    { mode: 'audit', section: 'audit', tab: 'modeAudit' },
    { mode: 'measure', section: 'measure', tab: 'modeMeasure' },
    { mode: 'agents', section: 'agents', tab: 'modeAgents' },
    { mode: 'policy', section: 'policy', tab: 'modePolicy' },
  ]

  singleInit()
  showMode('batch')

  // ---- Detail view (ui-design §5-§7) --------------------------------------

  function fieldStatus(state) {
    switch (state) {
      case 'MATCH': return { icon: '✓', cls: 'ok', words: 'Matches' }
      case 'LOW_CONFIDENCE': return { icon: '✓', cls: 'warn', words: 'Matches — please double-check' }
      case 'MISMATCH': return { icon: '✗', cls: 'bad', words: 'Does not match' }
      case 'MISSING_ON_LABEL': return { icon: '✗', cls: 'bad', words: 'Missing from the label' }
      case 'UNREADABLE': return { icon: '!', cls: 'warn', words: 'Could not read this on the label' }
      default: return { icon: '—', cls: 'muted', words: 'Not on the application' }
    }
  }

  function outcomeClass(outcome) {
    if (outcome === 'DISCREPANCIES_FOUND') return 'bad'
    if (outcome === 'INCOMPLETE' || outcome === 'CLEAR_CONFIRM_POLICY') return 'warn'
    return 'ok'
  }

  function renderField(f) {
    var wrap = el('div', 'field')
    wrap.appendChild(el('div', 'fname', f.label))
    var s = fieldStatus(f.state)
    var st = el('div', 'fstatus ' + s.cls)
    st.appendChild(el('span', null, s.icon + '  '))
    st.appendChild(document.createTextNode(s.words))
    wrap.appendChild(st)
    var vals = el('div', 'vals')
    var a = el('div'); a.appendChild(el('span', 'k', 'Application:')); a.appendChild(el('span', null, f.expected || '—')); vals.appendChild(a)
    var b = el('div'); b.appendChild(el('span', 'k', 'On the label:')); b.appendChild(el('span', null, f.observed || '—')); vals.appendChild(b)
    wrap.appendChild(vals)
    // The rule line shows only when a rule was actually exercised (ui-design §6.3).
    var line = f.explanation || (f.state === 'MISMATCH' ? f.rule : '')
    if (line) wrap.appendChild(el('div', 'rule', line))
    return wrap
  }

  // A rule the label was judged against, and what the judgement rested on.
  // Every entry names its citation, so an agent can go and read the regulation
  // rather than take this system's word for it (FR-10).
  function findingStatus(f) {
    if (f.state === 'VIOLATED' && f.severity === 'blocking') return { icon: '✗', cls: 'bad', words: 'Not met' }
    if (f.state === 'VIOLATED') return { icon: '?', cls: 'warn', words: 'Not met — your judgement' }
    if (f.state === 'UNDETERMINED') return { icon: '?', cls: 'warn', words: 'Could not be judged from the artwork' }
    if (f.state === 'NOT_APPLICABLE') return { icon: '—', cls: 'muted', words: 'Does not apply' }
    return { icon: '✓', cls: 'ok', words: 'Met' }
  }

  function renderFindings(findings, policy) {
    var box = el('div')
    box.appendChild(el('h2', null, 'Rules applied'))

    // What selected them, before what they said.
    //
    // Product type decides which body of regulation this submission is judged
    // by, and it is read from item 5 rather than stated by anyone here. An
    // agent looking at a clean result has no other way to tell the difference
    // between "checked against the spirits rules and passed" and "no rules
    // could be selected, so nothing was checked" — and the second is not a
    // pass.
    if (policy) {
      if (policy.productType) {
        box.appendChild(el('p', 'note', 'Judged as ' + policy.productType + ', read from item 5 of the application.'))
      } else {
        box.appendChild(el('p', 'warn-note', 'No product type could be read from item 5, so no rules could be selected. Nothing here has been checked against any regulation.'))
      }
    }

    if (!findings || !findings.length) {
      box.appendChild(el('p', 'note', 'No rules were applied to this submission.'))
      return box
    }
    // Satisfied rules last: an agent opens this to find what needs them, and a
    // list ordered by rule id buries three problems under nine passes.
    var order = { VIOLATED: 0, UNDETERMINED: 1, NOT_APPLICABLE: 3, SATISFIED: 2 }
    findings.slice().sort(function (a, b) {
      return (order[a.state] === undefined ? 9 : order[a.state]) - (order[b.state] === undefined ? 9 : order[b.state])
    }).forEach(function (f) {
      var s = findingStatus(f)
      var row = el('div', 'finding')
      var line = el('div', 'fstatus ' + s.cls)
      line.appendChild(el('span', null, s.icon + '  '))
      line.appendChild(document.createTextNode(s.words))
      row.appendChild(line)
      row.appendChild(el('div', 'freq', f.requirement))
      row.appendChild(el('div', 'dev', f.evidence))
      var cite = el('div', 'rule')
      cite.textContent = f.citation ? f.citation + ' · ' + f.ruleId : f.ruleId
      row.appendChild(cite)
      box.appendChild(row)
    })
    return box
  }

  /**
   * Ask the model again, on demand (audit/reread.ts).
   *
   * Placed here, above the decision, because this is where a person is deciding
   * and this is evidence they may want first: the verdict rests on a reading,
   * and *does the model still read it that way* is a question replay cannot
   * answer. It is the difference between telling an applicant "our arithmetic
   * is consistent" and "we asked again and got the same answer".
   *
   * On demand rather than automatic, because each one costs a model call
   * against a metered API. A panel that re-read every verdict on load would
   * spend an inference budget on being opened.
   */
  function renderReread(d) {
    var box = el('div', 'decision')
    box.appendChild(el('h2', null, 'Check the reading'))
    if (!d.submissionId) return box

    box.appendChild(el('p', 'note',
      'The verdict above was computed from a reading of this artwork. This puts the same image back to the model and compares what comes back. It changes nothing — it is evidence about the reading, which re-deriving the verdict cannot give you.'))

    var out = el('div')
    var btn = el('button', 'secondary', 'Ask the model again')
    btn.addEventListener('click', function () {
      btn.disabled = true
      btn.textContent = 'Reading…'
      out.textContent = ''
      fetch('/audit/reread/' + encodeURIComponent(d.submissionId), { method: 'POST' })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b } }) })
        .then(function (res) {
          btn.disabled = false
          btn.textContent = 'Ask the model again'
          renderRereadResult(out, res)
        })
        .catch(function () {
          btn.disabled = false
          btn.textContent = 'Ask the model again'
          out.appendChild(el('p', 'err', 'The model could not be reached. The verdict is unaffected.'))
        })
    })
    box.appendChild(btn)
    box.appendChild(out)
    return box
  }

  function renderRereadResult(out, res) {
    var b = res.body || {}
    if (!res.ok) {
      // A purged submission is a policy working, not a fault (D32).
      out.appendChild(el('p', b.error === 'content_purged' ? 'note' : 'err',
        b.reason || 'The re-read could not be completed. The verdict is unaffected.'))
      return
    }

    var line = el('div', 'fstatus ' + (b.identical ? 'ok' : 'warn'))
    line.appendChild(el('span', null, (b.identical ? '✓' : '!') + '  '))
    line.appendChild(document.createTextNode(
      b.identical ? 'The model read it the same way' : 'The model read it differently'))
    out.appendChild(line)
    if (b.renderedFrom) out.appendChild(el('div', 'dev', 'Read from ' + b.renderedFrom + '.'))

    // What the record could and could not put back.
    //
    // A re-read is only as meaningful as the conditions it restored, and this
    // is where the record is tested as much as the model is: a condition it
    // cannot reconstitute is a gap in what was stored, and saying so is more
    // useful than a comparison that quietly used today's settings.
    var c = b.conditions
    if (c) {
      out.appendChild(el('div', 'freq', 'Conditions of the original run'))
      ;[['model', 'The reader'], ['prompt', 'The instruction'], ['sampling', 'The parameters'], ['rasterDpi', 'The resolution']]
        .forEach(function (pair) {
          var k = c[pair[0]]
          if (!k) return
          var row = el('div', 'dev')
          row.textContent = (k.restored ? '✓ ' : '— ') + pair[1] + ': ' +
            (k.recorded === null || k.recorded === undefined ? 'not recorded' : String(k.recorded)) +
            (k.restored ? ' (restored)' : ' — ' + (k.reason || 'not restored'))
          out.appendChild(row)
        })
    }

    ;(b.regions || []).forEach(function (r) {
      var title = r.region === 'label' ? 'The label artwork' : 'The application record'
      out.appendChild(el('div', 'freq', title + (r.identical ? ' — unchanged' : ' — differs')))

      if (!r.sameReader) {
        // Otherwise a configuration change gets attributed to the model (D29).
        out.appendChild(el('div', 'dev',
          'Not the reader that answered originally: ' + r.reader.recordedModel + ' at ' +
          r.reader.recordedPrompt + ', now ' + r.reader.freshModel + ' at ' + r.reader.freshPrompt +
          '. A difference here says the reader changed, not that its reading drifted.'))
      }

      ;(r.fields || []).forEach(function (f) {
        if (f.same) return
        out.appendChild(el('div', 'dev',
          f.field + ': was ' + JSON.stringify(f.recorded) + ', now ' + JSON.stringify(f.fresh) +
          (f.unreadable ? ' (one reading declined to read it)' : '')))
      })
      if (r.warningStatement && !r.warningStatement.same) {
        out.appendChild(el('div', 'dev', 'The warning statement transcribed differently.'))
      }
    })

    if (b.note) out.appendChild(el('p', 'note', b.note))
  }

  // The agent's decision (§18.5). The system has said everything it can say by
  // this point; this is where a person takes responsibility, and the record of
  // what they chose against what was suggested is the only ground truth this
  // system will ever have.
  function renderDecision(d) {
    var box = el('div', 'decision')
    box.appendChild(el('h2', null, 'Your decision'))

    if (!d.outcome) {
      box.appendChild(el('p', 'note', 'This submission has not been checked yet.'))
      return box
    }

    if (d.decision) {
      // Told, not worked out. This had its own copy of the agreement rule and
      // no way to notice if it drifted from the one the record uses.
      var agreed = d.decision.agreed
      var head = el('div', 'fstatus ' + (agreed ? 'ok' : 'warn'))
      head.textContent = d.decision.decision === 'APPROVED' ? '✓  Approved'
        : d.decision.decision === 'REJECTED' ? '✗  Rejected'
        : '↩  Returned for better artwork'
      box.appendChild(head)
      box.appendChild(el('div', 'dev',
        'by ' + d.decision.decidedBy + ' on ' + d.decision.decidedAt.slice(0, 10)))
      // Shown whether or not it agreed. A record that displayed only
      // disagreements would make the agent's routine work invisible and the
      // exceptions look like accusations.
      if (!agreed) box.appendChild(el('div', 'dev', 'This differed from what the check suggested.'))
      if (d.decision.note) box.appendChild(el('div', 'dev', d.decision.note))
      return box
    }

    box.appendChild(el('p', 'note', d.recommendation || ''))

    // A list rather than a box. A typed name could be a colleague, a typo, or
    // nobody — three states the record could not tell apart, and the whole
    // value of "who decided this" is that it names a specific person.
    //
    // It is NOT authentication, and the hint below says so rather than letting
    // a dropdown imply a login (§19.5).
    var who = document.createElement('select')
    who.id = 'decidedBy'
    who.setAttribute('aria-label', 'Who is deciding')
    var waiting = document.createElement('option')
    waiting.value = ''; waiting.textContent = 'Select who is deciding…'
    who.appendChild(waiting)
    box.appendChild(who)
    box.appendChild(el('p', 'hint', 'Recorded as entered. This prototype does not verify identity.'))

    // Only agents entitled to decide. The server re-checks it — a dropdown
    // narrows what can be picked, not what a request can carry (§4.5).
    fetch('/users?role=compliance-agent')
      .then(function (r) { return r.ok ? r.json() : { users: [] } })
      .then(function (d) {
        (d.users || []).forEach(function (u) {
          var o = document.createElement('option')
          o.value = u.name
          o.textContent = u.name + ' — ' + u.role
          who.appendChild(o)
        })
      })
      .catch(function () { /* the server refuses an unrecognised name anyway */ })

    var note = document.createElement('textarea')
    note.id = 'decisionNote'; note.rows = 2
    note.placeholder = 'Why (required if you differ from the check)'
    note.setAttribute('aria-label', 'Reason')
    box.appendChild(note)

    var err = el('p', 'inline-err hidden'); err.id = 'decisionErr'
    box.appendChild(err)

    var row = el('div', 'decision-actions')
    ;[['APPROVED', 'Approve'], ['REJECTED', 'Reject'], ['RETURNED', 'Return for better artwork']]
      .forEach(function (pair) {
        var b = document.createElement('button')
        b.type = 'button'
        b.className = pair[0] === 'APPROVED' ? '' : 'secondary'
        b.textContent = pair[1]
        b.addEventListener('click', function () { submitDecision(d, pair[0], b) })
        row.appendChild(b)
      })
    box.appendChild(row)
    return box
  }

  function submitDecision(d, decision, button) {
    var err = byId('decisionErr')
    err.classList.add('hidden')
    button.disabled = true
    fetch('/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        submissionId: d.submissionId,
        decision: decision,
        decidedBy: byId('decidedBy').value.trim(),
        note: byId('decisionNote').value
      })
    }).then(function (r) {
      return r.json().then(function (body) { return { ok: r.ok, body: body } })
    }).then(function (res) {
      button.disabled = false
      if (!res.ok) {
        // The server's sentence, not one invented here. It is the one that
        // explains why a departure needs a reason.
        err.textContent = (res.body && res.body.reason) || 'That could not be recorded.'
        err.classList.remove('hidden')
        return
      }
      // Re-rendered from what was just recorded rather than refetched: the
      // single-review path has no job to fetch a detail from, and the outcome
      // shown is the one the server decided against, not the one this page
      // sent.
      d.decision = {
        decision: decision,
        decidedBy: byId('decidedBy').value.trim(),
        decidedAt: new Date().toISOString(),
        recommendedOutcome: res.body.recommendedOutcome,
        agreed: res.body.agreed,
        note: byId('decisionNote').value.trim() || null
      }
      renderDetail(d)
      // The worklist behind the sheet is now out of date about this row.
      loadDecided()
    }).catch(function () {
      button.disabled = false
      err.textContent = 'That could not be recorded.'
      err.classList.remove('hidden')
    })
  }

  function renderWarning(w) {
    var box = el('div')
    box.appendChild(el('h2', null, 'Government warning'))
    if (w.referenceUnverified) {
      box.appendChild(el('div', 'banner', 'The statutory warning text has not yet been confirmed against the primary source. These warning results are provisional.'))
    }
    if (!w.evaluated) {
      box.appendChild(el('p', 'note', 'The warning statement was not evaluated for this submission.'))
      return box
    }
    var head = el('div', 'fstatus ' + (w.ok ? 'ok' : 'bad'))
    head.textContent = (w.ok ? '✓  ' : '✗  ') + (w.ok ? 'The warning statement is correct' : 'The wording is not correct')
    box.appendChild(head)
    w.segments.forEach(function (seg) {
      var s = el('div', 'warning-seg')
      var line = el('div', seg.ok ? 'ok' : 'bad')
      line.textContent = (seg.ok ? '✓  ' : '✗  ') + seg.label
      s.appendChild(line)
      if (!seg.ok) {
        if (seg.deviation) s.appendChild(el('div', 'dev', seg.deviation))
        var req = el('div', 'dev'); req.textContent = 'Required: ' + seg.required; s.appendChild(req)
        if (seg.observed) { var obs = el('div', 'dev'); obs.textContent = 'On label: ' + seg.observed; s.appendChild(obs) }
      }
      box.appendChild(s)
    })
    if (w.advisory && w.advisory.length) {
      var adv = el('div', 'advisory')
      adv.appendChild(el('p', 'note', 'Please check these by eye — they cannot be verified from an image:'))
      w.advisory.forEach(function (a) {
        var lab = el('label')
        var cb = document.createElement('input'); cb.type = 'checkbox'
        lab.appendChild(cb); lab.appendChild(document.createTextNode(a.text))
        adv.appendChild(lab)
      })
      box.appendChild(adv)
    }
    return box
  }

  function closeDetail() {
    detail.classList.add('hidden')
    detail.textContent = ''
    document.removeEventListener('keydown', onDetailKey)
    if (lastFocused) lastFocused.focus()
  }

  function onDetailKey(e) { if (e.key === 'Escape') closeDetail() }

  // ---- Single review (§4) -------------------------------------------------
  var attached = null

  function byId(id) { return document.getElementById(id) }

  // Three screens now, so the argument is a name rather than a boolean. It was
  // showMode(true|false), which stopped being able to say which screen the
  // moment there were more than two.
  // The archive, rendered for a person deciding whether to approve something.
  //
  // Grouped by what a reviewer is doing rather than by rule id: what is in
  // force, what is waiting on them, and what used to apply. The last group
  // matters because a verdict from six months ago was judged by a rule that may
  // no longer be in force, and D27 keeps it rather than deleting it.
  var policyLoaded = false
  function loadPolicy() {
    if (policyLoaded) return
    policyLoaded = true
    var body = byId('policyBody')
    body.textContent = 'Loading…'
    fetch('/policy/rules')
      .then(function (r) { if (!r.ok) throw new Error('policy unavailable'); return r.json() })
      .then(function (d) { renderPolicy(d) })
      .catch(function () {
        policyLoaded = false
        body.textContent = ''
        body.appendChild(el('p', 'err', 'The policy could not be loaded. Please try again in a moment.'))
      })
  }

  /**
   * The agent register (§19, D46).
   *
   * Grouped by kind, in the order the governing principle puts them: people
   * first. A list that opened with the machines would read as though the
   * machines were the establishment and the people an annotation.
   */
  var agentsLoaded = false
  function loadAgents() {
    if (agentsLoaded) return
    agentsLoaded = true
    var body = byId('agentsBody')
    body.textContent = 'Loading…'
    fetch('/agents')
      .then(function (r) { if (!r.ok) throw new Error('agents unavailable'); return r.json() })
      .then(function (d) { renderAgents(d) })
      .catch(function () {
        agentsLoaded = false
        body.textContent = ''
        body.appendChild(el('p', 'err', 'The agent register could not be loaded. Please try again in a moment.'))
      })
  }

  var KIND_TITLE = {
    human: 'People',
    model: 'Models',
    system: 'The system itself',
  }
  var KIND_NOTE = {
    human: 'Recognised, not authenticated: this says who may act, not that whoever typed a name is that person.',
    model: 'A reader is identified by its whole tuple — provider, model and prompt version — because each of them changes what it produces.',
    system: 'The deployment executing its own steps. Opening a job is execution, not anyone deciding.',
  }

  function renderAgents(d) {
    var body = byId('agentsBody')
    body.textContent = ''

    var agents = (d && d.agents) || []
    ;['human', 'model', 'system'].forEach(function (kind) {
      var of = agents.filter(function (a) { return a.kind === kind })
      if (!of.length) return
      var box = el('div')
      box.appendChild(el('h2', null, KIND_TITLE[kind] + ' (' + of.length + ')'))
      box.appendChild(el('p', 'note', KIND_NOTE[kind]))
      of.forEach(function (a) { box.appendChild(agentRow(a)) })
      body.appendChild(box)
    })

    if (d && d.note) body.appendChild(el('p', 'note', d.note))
  }

  function agentRow(a) {
    var row = el('div', 'finding')

    // What it may decide, first and in plain words. It is the one fact on this
    // page that is a rule rather than a description, and the code enforces it.
    var line = el('div', 'fstatus ' + (a.mayDecide ? 'ok' : 'muted'))
    line.appendChild(el('span', null, (a.mayDecide ? '✓' : '—') + '  '))
    line.appendChild(document.createTextNode(a.mayDecide ? 'May decide' : 'May not decide'))
    row.appendChild(line)

    row.appendChild(el('div', 'freq', a.display + ' — ' + a.role))
    ;(a.entitlements || []).forEach(function (e) {
      row.appendChild(el('div', 'dev', '· ' + e))
    })
    // The identity exactly as the record carries it, so a line in the audit
    // trail can be matched to a row on this page without interpretation.
    row.appendChild(el('div', 'rule', a.id))
    if (a.source) row.appendChild(el('div', 'dev', a.source))
    return row
  }

  /**
   * Auditing a record — the act, not a dashboard (NFR-13).
   *
   * This screen used to report chain integrity and replay counts across every
   * verdict, which is a health check: useful, and not an audit. An audit is
   * somebody examining ONE determination and concluding something about it,
   * and a conclusion nobody recorded is a conversation.
   *
   * So it lists what can be audited — the records a person actually decided —
   * runs the checks for one on demand, shows the two things being compared
   * side by side, and asks a human to conclude. The system never awards the
   * result: a machine signing off on the soundness of its own record is
   * precisely what an audit exists to withhold.
   */
  var auditLoaded = false
  function loadAudit() {
    if (auditLoaded) return
    auditLoaded = true
    var body = byId('auditBody')
    body.textContent = 'Loading…'
    fetch('/audit/records')
      .then(function (r) { if (!r.ok) throw new Error('unavailable'); return r.json() })
      .then(function (d) { renderAudit(d) })
      .catch(function () {
        auditLoaded = false
        body.textContent = ''
        body.appendChild(el('p', 'err', 'The records could not be loaded. Please try again in a moment.'))
      })
  }

  function renderAudit(d) {
    var body = byId('auditBody')
    body.textContent = ''

    var records = (d && d.records) || []
    if (!records.length) {
      body.appendChild(el('p', 'note', (d && d.note) || 'Nothing to audit yet.'))
      return
    }

    body.appendChild(el('h2', null, 'Records ready for audit (' + records.length + ')'))
    body.appendChild(el('p', 'note', d.note))

    records.forEach(function (r) {
      var row = el('div', 'finding')
      var head = el('div', 'freq')
      head.textContent = (r.source_name || r.submission_id) + ' — ' + r.decision +
        ' by ' + r.decided_by + ' on ' + String(r.decided_at).slice(0, 10)
      row.appendChild(head)
      if (r.reference_code) row.appendChild(el('div', 'rule', String(r.reference_code)))

      if (r.audits > 0) {
        row.appendChild(el('div', 'dev',
          'Audited: ' + r.last_result + ' by ' + r.last_by +
          (r.audits > 1 ? ' (' + r.audits + ' audits)' : '')))
      }
      if (r.content_purged_at) {
        row.appendChild(el('div', 'dev',
          'The filing was deleted under the retention policy on ' +
          String(r.content_purged_at).slice(0, 10) + ', so it cannot be re-read. The verdict can still be re-derived.'))
      }

      var out = el('div')
      var btn = el('button', 'secondary', 'Audit this record')
      btn.addEventListener('click', function () {
        btn.disabled = true
        btn.textContent = 'Checking…'
        out.textContent = ''
        fetch('/audit/run/' + encodeURIComponent(r.submission_id), { method: 'POST' })
          .then(function (x) { return x.json() })
          .then(function (report) {
            btn.disabled = false
            btn.textContent = 'Audit this record'
            renderAuditReport(out, r, report)
          })
          .catch(function () {
            btn.disabled = false
            btn.textContent = 'Audit this record'
            out.appendChild(el('p', 'err', 'The checks could not be run.'))
          })
      })
      row.appendChild(btn)
      row.appendChild(out)
      body.appendChild(row)
    })
  }

  /** The evidence, side by side, then the conclusion — which is the person's. */
  function renderAuditReport(out, record, report) {
    out.textContent = ''

    function check(label, status, ok, detail) {
      var row = el('div', 'finding')
      var line = el('div', 'fstatus ' + (ok === true ? 'ok' : ok === false ? 'bad' : 'muted'))
      line.appendChild(el('span', null, (ok === true ? '✓' : ok === false ? '✗' : '—') + '  '))
      line.appendChild(document.createTextNode(label + ': ' + status))
      row.appendChild(line)
      if (detail) row.appendChild(el('div', 'dev', detail))
      return row
    }

    var chainOk = report.chain && report.chain.status === 'ok'
    out.appendChild(check('The history', chainOk ? 'unaltered' : 'ALTERED', chainOk,
      report.chain ? report.chain.events + ' events, each committing to the one before it' : ''))

    var rep = report.replay || {}
    out.appendChild(check('The verdict, re-derived', rep.status || 'not run',
      rep.status === 'identical' ? true : rep.status === 'differs' ? false : null,
      'Re-run from the reading recorded at the time — same contract, same rules.'))

    // Side by side, because a status word is a conclusion and an auditor is
    // entitled to the two things being compared.
    if (report.sideBySide) {
      var sbs = el('div', 'finding')
      sbs.appendChild(el('div', 'freq', 'Side by side'))
      sbs.appendChild(el('div', 'dev', 'Recorded outcome: ' + (report.sideBySide.outcome.recorded || '—')))
      sbs.appendChild(el('div', 'dev', 'Re-derived outcome: ' + (report.sideBySide.outcome.rederived || 'did not re-derive')))
      ;(report.sideBySide.differences || []).forEach(function (x) {
        sbs.appendChild(el('div', 'dev', '· ' + x))
      })
      out.appendChild(sbs)
    }

    // The re-read is a second, paid step.
    var rereadStatus = { value: 'not-run' }
    var rrOut = el('div')
    var rrBtn = el('button', 'secondary', 'Also ask the model again')
    rrBtn.addEventListener('click', function () {
      rrBtn.disabled = true
      rrBtn.textContent = 'Reading…'
      fetch('/audit/reread/' + encodeURIComponent(record.submission_id), { method: 'POST' })
        .then(function (x) { return x.json().then(function (b) { return { ok: x.ok, body: b } }) })
        .then(function (res) {
          rrBtn.disabled = false
          rrBtn.textContent = 'Also ask the model again'
          rereadStatus.value = res.ok ? (res.body.identical ? 'identical' : 'differs') : (res.body.error || 'failed')
          renderRereadResult(rrOut, res)
        })
        .catch(function () {
          rrBtn.disabled = false
          rrBtn.textContent = 'Also ask the model again'
        })
    })
    out.appendChild(rrBtn)
    out.appendChild(rrOut)

    out.appendChild(renderAuditConclusion(record, report, rereadStatus))
  }

  /**
   * The conclusion, which the system does not draw.
   *
   * It offers no default and computes no result. The three options are put to a
   * person with their name against them, exactly as a decision is, because an
   * audit a machine awarded itself would be worth nothing.
   */
  function renderAuditConclusion(record, report, rereadStatus) {
    var box = el('div', 'decision')
    box.appendChild(el('h2', null, 'Your conclusion'))
    box.appendChild(el('p', 'note',
      'The checks above are evidence, not a finding. Recording an audit says a person looked at them and concluded something — and it is kept against the verdict, in the same history it examined.'))

    var who = document.createElement('select')
    who.setAttribute('aria-label', 'Who is recording this audit')
    var waiting = document.createElement('option')
    waiting.value = ''; waiting.textContent = 'Select who is auditing…'
    who.appendChild(waiting)
    box.appendChild(who)
    box.appendChild(el('p', 'hint', 'Recorded as entered. This prototype does not verify identity.'))

    // The same register the decision control draws on, and the server re-checks
    // it: a dropdown narrows what can be picked, not what a request can carry.
    fetch('/users?role=compliance-agent')
      .then(function (r) { return r.ok ? r.json() : { users: [] } })
      .then(function (d) {
        (d.users || []).forEach(function (u) {
          var o = document.createElement('option')
          o.value = u.name
          o.textContent = u.name + ' — ' + u.role
          who.appendChild(o)
        })
      })
      .catch(function () { /* the server refuses an unrecognised name anyway */ })

    var result = document.createElement('select')
    ;[['', 'What did you conclude?'],
      ['UPHELD', 'The record holds up'],
      ['CONCERNS', 'Holds up, with something to explain'],
      ['FAILED', 'The record does not hold up']].forEach(function (pair) {
        var o = el('option', null, pair[1]); o.value = pair[0]; result.appendChild(o)
      })
    box.appendChild(result)

    var note = document.createElement('textarea')
    note.rows = 2
    note.placeholder = 'Anything a later reader would need to know (optional)'
    box.appendChild(note)

    var msg = el('p', 'note', '')
    var save = el('button', null, 'Record this audit')
    save.addEventListener('click', function () {
      if (!who.value || !result.value) {
        msg.textContent = 'Please say who is recording this, and what you concluded.'
        return
      }
      save.disabled = true
      fetch('/audit/record/' + encodeURIComponent(record.submission_id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          auditedBy: who.value,
          result: result.value,
          note: note.value,
          evidence: {
            chainStatus: report.chain ? report.chain.status : null,
            replayStatus: report.replay ? report.replay.status : null,
            rereadStatus: rereadStatus.value,
          },
        }),
      })
        .then(function (x) { return x.json().then(function (b) { return { ok: x.ok, body: b } }) })
        .then(function (res) {
          save.disabled = false
          msg.textContent = res.ok
            ? 'Recorded — ' + res.body.result + ' by ' + res.body.auditedBy + '.'
            : (res.body.reason || 'The audit could not be recorded.')
        })
        .catch(function () {
          save.disabled = false
          msg.textContent = 'The audit could not be recorded.'
        })
    })
    box.appendChild(save)
    box.appendChild(msg)
    return box
  }

  /**
   * What this deployment has done, and what it cost (§16, D52).
   *
   * Deliberately plain. Every figure carries the sample it was drawn from,
   * because a p95 over four readings and a p95 over four hundred are different
   * claims and only one of them is worth acting on — and a number without its
   * denominator is the kind that gets quoted in a slide.
   */
  var measureLoaded = false
  function loadMeasurement() {
    if (measureLoaded) return
    measureLoaded = true
    var body = byId('measureBody')
    body.textContent = 'Loading…'
    fetch('/measurement')
      .then(function (r) { if (!r.ok) throw new Error('unavailable'); return r.json() })
      .then(function (d) { renderMeasurement(d) })
      .catch(function () {
        measureLoaded = false
        body.textContent = ''
        body.appendChild(el('p', 'err', 'The measurement could not be loaded. Please try again in a moment.'))
      })
  }

  function ms(v) { return v === null || v === undefined ? '—' : (v / 1000).toFixed(2) + ' s' }
  function num(v) { return v === null || v === undefined ? 'not reported' : String(v).replace(/B(?=(d{3})+(?!d))/g, ',') }

  function renderMeasurement(d) {
    var body = byId('measureBody')
    body.textContent = ''

    // The stated criterion first, and its verdict in words. §16: a criterion
    // without a measurement is an intention rather than a claim.
    var v = d.verification || {}
    var box = el('div')
    box.appendChild(el('h2', null, 'Against the stated target'))
    var line = el('div', 'fstatus ' + (v.meetsTarget === true ? 'ok' : v.meetsTarget === false ? 'bad' : 'muted'))
    line.appendChild(el('span', null, (v.meetsTarget === true ? '✓' : v.meetsTarget === false ? '✗' : '—') + '  '))
    line.appendChild(document.createTextNode(
      v.meetsTarget === null || v.meetsTarget === undefined
        ? 'Nothing has been checked yet, so there is nothing to judge.'
        : 'S1 — 95% of verifications within ' + ms(v.targetMs) + ': ' +
          (v.meetsTarget ? 'met' : 'not met')))
    box.appendChild(line)
    if (v.total && v.total.count) {
      box.appendChild(el('div', 'dev',
        'p50 ' + ms(v.total.p50) + ' · p95 ' + ms(v.total.p95) + ' · slowest ' + ms(v.total.max) +
        ' · over ' + v.total.count + ' verification' + (v.total.count === 1 ? '' : 's')))
      box.appendChild(el('div', 'dev',
        'Reading ' + ms(v.extract && v.extract.p50) + ' · comparing ' + ms(v.compare && v.compare.p50) + ' (p50)'))
    }
    body.appendChild(box)

    // Per region, because the label and the record are different work and an
    // average of the two hides which one is slow.
    if (d.reads && d.reads.length) {
      var reads = el('div')
      reads.appendChild(el('h2', null, 'Each read'))
      d.reads.forEach(function (r) {
        var row = el('div', 'finding')
        row.appendChild(el('div', 'freq', r.region === 'label' ? 'The label artwork' : 'The application record'))
        row.appendChild(el('div', 'dev',
          'p50 ' + ms(r.latency.p50) + ' · p95 ' + ms(r.latency.p95) + ' · slowest ' + ms(r.latency.max) +
          ' · over ' + r.latency.count + ' read' + (r.latency.count === 1 ? '' : 's')))
        row.appendChild(el('div', 'dev', r.tokensReported + ' of ' + r.latency.count + ' reported a token count'))
        reads.appendChild(row)
      })
      body.appendChild(reads)
    }

    // What it cost, per reader. "Which model reads best" has a price (B-Q4).
    if (d.cost && d.cost.length) {
      var cost = el('div')
      cost.appendChild(el('h2', null, 'What it cost'))
      d.cost.forEach(function (c) {
        var row = el('div', 'finding')
        row.appendChild(el('div', 'freq', c.provider + ' · ' + c.modelId))
        row.appendChild(el('div', 'dev',
          num(c.totalTokens) + ' tokens across ' + c.reads + ' read' + (c.reads === 1 ? '' : 's') +
          (c.reported === c.reads ? '' : ' — ' + c.reported + ' of them counted')))
        if (c.promptTokens !== null || c.completionTokens !== null) {
          row.appendChild(el('div', 'dev', 'sent ' + num(c.promptTokens) + ' · returned ' + num(c.completionTokens)))
        }
        cost.appendChild(row)
      })
      body.appendChild(cost)
    }

    // The vendor's own analytics, linked rather than copied in.
    var g = d.gateway || {}
    var gw = el('div')
    gw.appendChild(el('h2', null, 'AI Gateway'))
    if (g.configured && g.url) {
      var a = document.createElement('a')
      a.href = g.url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = 'Open the gateway analytics (' + g.id + ')'
      gw.appendChild(a)
      if (g.requiresAccountAccess) {
        gw.appendChild(el('span', 'what', '  — needs access to the Cloudflare account'))
      }
    }
    if (g.note) gw.appendChild(el('p', 'note', g.note))
    body.appendChild(gw)

    if (d.window && d.window.note) body.appendChild(el('p', 'note', d.window.note))
  }

  function renderPolicy(d) {
    var body = byId('policyBody')
    body.textContent = ''

    var head = el('div', 'refline')
    head.appendChild(document.createTextNode('Policy set version '))
    head.appendChild(el('code', 'refcode', String(d.policySetVersion)))
    head.appendChild(document.createTextNode('  ·  approved by ' + (d.approvedBy || 'nobody named')))
    body.appendChild(head)

    group(body, 'In force', d.inForce, 'These rules are applied to every submission they govern.')
    group(body, 'Awaiting approval', d.awaitingApproval,
      'Proposed, and not applied to anything. A rule takes effect when it is approved in the reviewed policy file.')
    group(body, 'No longer in force', d.retired,
      'Kept, not deleted — a verdict reached under one of these still needs the rule that produced it.')
  }

  function group(parent, title, rules, note) {
    var box = el('div')
    box.appendChild(el('h2', null, title + ' (' + (rules ? rules.length : 0) + ')'))
    if (note) box.appendChild(el('p', 'note', note))
    if (!rules || !rules.length) {
      box.appendChild(el('p', 'note', 'None.'))
      parent.appendChild(box)
      return
    }
    rules.forEach(function (r) { box.appendChild(renderRule(r)) })
    parent.appendChild(box)
  }

  function renderRule(r) {
    var wrap = el('div', 'finding')
    var head = el('div', 'fstatus ' + (r.status === 'active' ? 'ok' : r.retiredAt ? 'muted' : 'warn'))
    head.textContent = (r.status === 'active' ? '✓  ' : r.retiredAt ? '—  ' : '?  ') + r.ruleId
    wrap.appendChild(head)
    wrap.appendChild(el('div', 'freq', r.requirement))

    // What it governs, and when. Both windows, because "in force" is two
    // different questions: which filings it covers, and since when we held it.
    var when = 'applies to ' + ((r.productTypes || []).join(', ') || 'every product type')
    when += r.effectiveFrom ? '  ·  filings from ' + r.effectiveFrom : '  ·  filings of any date'
    if (r.effectiveTo) when += ' to ' + r.effectiveTo
    when += '  ·  recorded ' + String(r.recordedAt).slice(0, 10)
    if (r.retiredAt) when += ', retired ' + String(r.retiredAt).slice(0, 10)
    wrap.appendChild(el('div', 'dev', when))

    if (r.quote) {
      var q = el('div', 'dev')
      q.textContent = '“' + r.quote + '”'
      wrap.appendChild(q)
    } else {
      wrap.appendChild(el('div', 'dev', 'No source quote recorded for this rule.'))
    }

    var foot = el('div', 'rule')
    var bits = [r.regulation || 'no citation']
    if (r.approvedBy) {
      // Which assurance the reader has. "Covered by the set's approval" and
      // "this person signed this rule" are not the same claim.
      bits.push((r.approvalInherited ? 'covered by the set approval of ' : 'approved by ') + r.approvedBy)
    } else {
      bits.push('NOT APPROVED')
    }
    if (r.proposedBy) bits.push('proposed by ' + r.proposedBy)
    foot.textContent = bits.join(' · ')
    wrap.appendChild(foot)
    return wrap
  }

  function showMode(mode) {
    SCREENS.forEach(function (s) {
      byId(s.section).classList.toggle('hidden', mode !== s.mode)
      byId(s.tab).setAttribute('aria-selected', String(mode === s.mode))
    })
    if (mode === 'policy') loadPolicy()
    if (mode === 'agents') loadAgents()
    if (mode === 'audit') loadAudit()
    if (mode === 'measure') loadMeasurement()
  }

  function clearFieldError(id) {
    var input = byId(id)
    if (input) input.removeAttribute('aria-invalid')
    var err = byId(id + 'Err')
    if (err) { err.textContent = ''; err.classList.add('hidden') }
  }

  // Marked invalid for assistive technology, message beneath the control, and
  // focus moved to the first problem — which tells the agent what to do rather
  // than leaving them to work it out (§4.5).
  function showFieldError(id, message) {
    var input = byId(id)
    if (input) { input.setAttribute('aria-invalid', 'true'); input.focus() }
    var err = byId(id + 'Err')
    if (err) { err.textContent = message; err.classList.remove('hidden') }
  }

  // The name and size BEFORE submission: the commonest upload mistake is the
  // wrong file, and finding that out after a five-second wait is a wasted
  // review. No thumbnail — a PDF does not render in an img element, and the
  // first page is not the label anyway.
  function attach(file) {
    if (!file) return
    attached = file
    byId('pickedName').textContent = file.name
    byId('pickedSize').textContent = (file.size / 1048576).toFixed(1) + ' MB'
    byId('drop').classList.add('hidden')
    byId('picked').classList.remove('hidden')
    clearFieldError('file')
  }

  /**
   * Take the document away, and its verdict with it.
   *
   * The verdict describes THIS document. Leaving it on screen after the
   * document has been removed puts a result above an empty picker, referring to
   * evidence that is no longer there — and the panel names a file that is not
   * attached.
   *
   * This used to leave the result, and a separate "Start again" button existed
   * to clear it. That button was justified by a screen with five typed fields,
   * where starting over meant editing all of them; with one upload, Remove IS
   * starting over. It was also redundant twice: checking a submission already
   * clears the previous result, so the only state it reached was one the next
   * action reached anyway.
   */
  function detach() {
    attached = null
    byId('file').value = ''
    byId('picked').classList.add('hidden')
    byId('drop').classList.remove('hidden')
    byId('singleResult').textContent = ''
    byId('working').classList.add('hidden')
    clearFieldError('file')
  }

  /**
   * The samples, fetched rather than baked into the page.
   *
   * Their titles and expected outcomes are authored ground truth held in the
   * corpus manifest. Rendering them from a copy in this file would be a second
   * statement of what each submission is, and the screen would be the one that
   * looked authoritative when the two disagreed.
   *
   * A failure here is silent by design: samples are a convenience, and an error
   * banner over a form that works perfectly well without them would report a
   * problem the agent does not have.
   */
  function loadSamples() {
    fetch('/samples')
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (d) {
        if (!d || !d.samples || !d.samples.length) return
        var list = byId('sampleList')
        list.textContent = ''
        d.samples.forEach(function (s) {
          var row = el('div', 'sample')
          var link = el('a', null, s.title)
          link.href = s.url
          // Named for what it is rather than for its id, so a downloaded file
          // is still identifiable in a folder a week later.
          link.setAttribute('download', '')
          row.appendChild(link)
          row.appendChild(el('span', 'what', s.shows))
          list.appendChild(row)
        })
      })
      .catch(function () { /* Samples are a convenience. Their absence is not an error. */ })
  }

  function singleInit() {
    SCREENS.forEach(function (s) {
      byId(s.tab).addEventListener('click', function () { showMode(s.mode) })
    })

    byId('pickBtn').addEventListener('click', function () { byId('file').click() })
    byId('replaceBtn').addEventListener('click', function () { byId('file').click() })
    byId('removeBtn').addEventListener('click', detach)
    byId('file').addEventListener('change', function (e) { attach(e.target.files[0]) })

    var drop = byId('drop')
    ;['dragenter', 'dragover'].forEach(function (type) {
      drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.add('over') })
    })
    ;['dragleave', 'drop'].forEach(function (type) {
      drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.remove('over') })
    })
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) attach(e.dataTransfer.files[0])
    })

    byId('checkBtn').addEventListener('click', runSingle)
    loadSamples()
  }

  function runSingle() {
    clearFieldError('file')
    byId('singleResult').textContent = ''

    // Validation on submit only (§4.5). One thing can be missing now, and the
    // message names it.
    if (!attached) return showFieldError('file', 'Please add the filed application as a PDF.')

    var working = byId('working')
    // Says what is happening, which is more than reading: the pages are
    // rendered first, and rendering is the slow step.
    working.textContent = 'Reading the submission…'
    working.classList.remove('hidden')
    var extended = setTimeout(function () {
      working.textContent = 'Still working — this is taking longer than usual.'
    }, 8000)

    var form = new FormData()
    form.append('submission', attached)

    fetch('/review', { method: 'POST', body: form })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b } }) })
      .then(function (res) {
        clearTimeout(extended)
        working.classList.add('hidden')
        if (!res.ok) {
          if (res.body && res.body.field === 'image') return showFieldError('file', res.body.reason)
          var e = el('p', 'err', (res.body && res.body.reason) || 'Something went wrong. Nothing was saved.')
          byId('singleResult').appendChild(e)
          return
        }
        // The same renderer as the batch path. One review screen, not two.
        detail.textContent = ''
        renderDetail(res.body)
      })
      .catch(function () {
        clearTimeout(extended)
        working.classList.add('hidden')
        byId('singleResult').appendChild(
          el('p', 'err', 'The label reading service is not responding. Nothing is wrong with your label — please try again in a moment.'),
        )
      })
  }

  function renderDetail(d) {
    detail.textContent = ''
    var sheet = el('div', 'sheet')

    var head = el('div', 'sheet-head')
    var titleWrap = el('div')
    titleWrap.appendChild(el('h2', null, d.sourceName)).id = 'detailTitle'
    head.appendChild(titleWrap)
    var close = el('button', 'secondary', 'Close')
    close.addEventListener('click', closeDetail)
    head.appendChild(close)
    sheet.appendChild(head)

    if (d.state === 'FAILED' || d.state === 'REJECTED') {
      var ob = el('div', 'outcome warn')
      var obw = el('div')
      obw.appendChild(el('div', 'big', 'This submission could not be processed'))
      obw.appendChild(el('div', null, d.cause || 'The submission could not be read.'))
      ob.appendChild(obw); sheet.appendChild(ob)
      mount(sheet); return
    }

    if (d.outcome) {
      var oc = outcomeClass(d.outcome)
      var banner = el('div', 'outcome ' + oc)
      banner.appendChild(el('div', 'status-icon ' + oc, oc === 'ok' ? '✓' : oc === 'bad' ? '✗' : '!'))
      var bw = el('div')
      bw.appendChild(el('div', 'big', d.headline || ''))
      // The recommendation, immediately under the headline. It never says
      // "approved" — the decision is the agent's, and the sentence says so.
      if (d.recommendation) bw.appendChild(el('div', 'recommend', d.recommendation))
      banner.appendChild(bw)
      sheet.appendChild(banner)
    }

    var layout = el('div', 'layout')
    var left = el('div')
    left.appendChild(el('h2', null, 'Fields'))
    d.fields.forEach(function (f) { left.appendChild(renderField(f)) })
    left.appendChild(renderWarning(d.warning))
    left.appendChild(renderFindings(d.findings, d.policy))
    left.appendChild(renderReread(d))
    left.appendChild(renderDecision(d))
    layout.appendChild(left)

    var right = el('div', 'imgpanel')

    // Content deleted under the retention policy is stated, not discovered.
    // Without this the panels would fail to load and the reviewer would read a
    // working policy as a broken tool — and might doubt the verdict with it.
    if (d.contentPurgedAt) {
      right.appendChild(el('div', 'purged',
        'The label artwork and the submission as filed were deleted on ' +
        d.contentPurgedAt.slice(0, 10) + ', under the retention policy. ' +
        'The verdict and everything it was computed from are unaffected.'))
    } else {

      var img = document.createElement('img')
      img.alt = 'Label artwork'
      img.src = d.labelImageUrl
      img.addEventListener('error', function () { right.classList.add('hidden') })
      right.appendChild(img)
      right.appendChild(el('div', 'cap', 'The label as read. Adjudicate against the artwork, not the verdict.'))

      // The whole submission, below the crop. The crop shows what the model was
      // given; this shows what the applicant filed. A verdict that disagrees with
      // the document — or a crop that caught the wrong region — is visible only
      // by looking at both.
      if (d.sourceUrl) {
        var frame = document.createElement('iframe')
        frame.className = 'pdf'
        frame.src = d.sourceUrl
        frame.title = 'The submission as filed'
        right.appendChild(frame)
        var link = document.createElement('a')
        link.href = d.sourceUrl
        link.target = '_blank'
        link.rel = 'noopener'
        link.textContent = 'Open the submission in a new tab'
        var cap = el('div', 'cap')
        cap.appendChild(link)
        right.appendChild(cap)
      }

    }
    layout.appendChild(right)

    sheet.appendChild(layout)

    // The reference, at the foot of every result (D21, ui-design §10).
    //
    // Selectable and monospaced because its whole job is to be copied or read
    // aloud accurately — an agent reporting a wrong verdict quotes this, and
    // an operator finds the record from it at /reference/<code>.
    if (d.reference) {
      var foot = el('div', 'refline')
      foot.appendChild(el('span', null, 'Reference: '))
      foot.appendChild(el('code', 'refcode', d.reference))
      sheet.appendChild(foot)
    }

    mount(sheet)
  }

  function mount(sheet) {
    detail.appendChild(sheet)
    detail.classList.remove('hidden')
    document.addEventListener('keydown', onDetailKey)
    detail.addEventListener('click', function (e) { if (e.target === detail) closeDetail() })

    // Focus lands on the OUTCOME, not on Close (ui-design §4, NF-A03).
    //
    // Focusing the first button put a screen-reader user on "Close" and made
    // them hunt backwards for the finding — the one thing they opened the
    // sheet for. The banner is given tabindex="-1" so it can take focus
    // without entering the tab order, and role="status" so the outcome is
    // announced rather than silently rendered.
    var banner = sheet.querySelector('.outcome')
    if (banner) {
      banner.setAttribute('tabindex', '-1')
      banner.setAttribute('role', 'status')
      banner.focus()
    } else {
      var btn = sheet.querySelector('button')
      if (btn) btn.focus()
    }
  }

  function openDetail(itemId, sourceName) {
    lastFocused = document.activeElement
    fetch('/batch/' + jobId + '/submission/' + encodeURIComponent(itemId))
      .then(function (r) { if (!r.ok) throw new Error('detail failed'); return r.json() })
      .then(function (d) {
        // The submission as filed, alongside the crop the model was shown.
        d.sourceUrl = '/batch/' + jobId + '/submission/' + encodeURIComponent(itemId) + '/source.pdf'
        renderDetail(d)
      })
      .catch(function () {
        detail.textContent = ''
        var sheet = el('div', 'sheet')
        sheet.appendChild(el('p', 'err', 'This result could not be opened. Please try again in a moment.'))
        var c = el('button', 'secondary', 'Close'); c.addEventListener('click', closeDetail)
        sheet.appendChild(c)
        mount(sheet)
      })
  }
})()
</script>
</body>
</html>`
