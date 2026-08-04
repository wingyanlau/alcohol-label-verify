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
  .warning-seg { padding: 8px 0; }
  .warning-seg .dev { color: var(--muted); font-size: 15px; }
  .advisory { border-top: 1px solid var(--line); margin-top: 16px; padding-top: 14px; }
  .advisory label { display: flex; gap: 10px; align-items: flex-start; padding: 5px 0; }
  .banner { background: #fdf6e3; border: 1px solid #ecdca6; border-radius: 6px; padding: 10px 14px; font-size: 15px; color: var(--warn); margin-bottom: 16px; }
  .err { color: var(--bad); margin-top: 12px; }

  /* Single review (§4). */
  .topbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
  .modes { display: flex; gap: 8px; }
  .mode { padding: 8px 16px; font-size: 16px; }
  .mode[aria-selected="false"] { background: var(--panel); color: var(--ink); }
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
  .primary-row { margin-top: 24px; text-align: center; }
  .primary-row button { font-size: 19px; padding: 14px 28px; }
  @media (max-width: 820px) { .primary-row button { width: 100%; } }
</style>
</head>
<body>
<main>
  <!-- Region A: product name and the mode switch, and no other chrome (§4.1). -->
  <div class="topbar">
    <h1>TTB Label Check</h1>
    <div class="modes" role="tablist" aria-label="Mode">
      <button id="modeSingle" type="button" class="mode" role="tab" aria-selected="true">Single review</button>
      <button id="modeBatch" type="button" class="mode secondary" role="tab" aria-selected="false">Batch</button>
    </div>
  </div>

  <!-- Single review (§4). Two numbered panels, because the numbering describes
       the comparison the agent is performing rather than imposing steps. -->
  <section id="single">
    <div class="layout2">
      <div class="panel">
        <h2>1. The application says</h2>
        <div class="fieldrow">
          <label for="brandName">Brand name <span class="req">(required)</span></label>
          <input id="brandName" name="brandName" type="text" autocomplete="off">
          <p class="inline-err hidden" id="brandNameErr"></p>
        </div>
        <div class="fieldrow">
          <label for="classType">Class / type</label>
          <input id="classType" name="classType" type="text" autocomplete="off">
          <p class="hint">e.g. Kentucky Straight Bourbon Whiskey</p>
        </div>
        <div class="fieldrow">
          <!-- Text, not type=number: a number input rejects a pasted
               "45% Alc./Vol.", adds spinners nobody wants, and disagrees with
               itself across locale decimal separators (§4.2). -->
          <label for="alcoholContent">Alcohol content</label>
          <div class="suffixed">
            <input id="alcoholContent" name="alcoholContent" type="text" autocomplete="off">
            <span class="suffix">%</span>
          </div>
        </div>
        <div class="fieldrow">
          <label for="netContents">Net contents</label>
          <input id="netContents" name="netContents" type="text" autocomplete="off">
          <p class="hint">e.g. 750 mL</p>
        </div>
      </div>

      <div class="panel">
        <h2>2. The label</h2>
        <!-- Drag-and-drop is never the only affordance: the button is the
             primary one, the drop zone a convenience (§4.3). -->
        <div id="drop" class="drop">
          <p class="dropmsg">Drop the label image here</p>
          <button id="pickBtn" type="button" class="secondary">Choose a file</button>
          <p class="constraint">JPEG or PNG, up to 10 MB</p>
          <input id="file" type="file" accept="image/png,image/jpeg" class="hidden">
        </div>
        <div id="picked" class="picked hidden">
          <img id="thumb" alt="The label you attached">
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
      </div>
    </div>

    <!-- Never disabled (§4.4). A disabled button is unfocusable, announces
         nothing, and gives a hesitant person no reason for the silence.
         Pressing it with an incomplete form runs validation and moves focus to
         the problem, which tells them what to do. -->
    <div class="primary-row">
      <button id="checkBtn" type="button">Check this label</button>
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
  var lastFocused = null

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  // Outcome -> presentation. The internal vocabulary stops here (ui-design §12).
  function present(row) {
    if (row.state === 'FAILED' || row.state === 'REJECTED') {
      return { icon: 'x', cls: 'warn', words: 'Could not process', rank: 1 }
    }
    if (row.state === 'QUEUED') return { icon: '…', cls: 'muted', words: 'Waiting', rank: 5 }
    if (row.state === 'RUNNING') return { icon: '•', cls: 'muted', words: 'Checking…', rank: 4 }
    switch (row.outcome) {
      case 'DISCREPANCIES_FOUND': return { icon: '✗', cls: 'bad', words: 'Problems found', rank: 0 }
      case 'INCOMPLETE': return { icon: '!', cls: 'warn', words: 'Could not finish the check', rank: 2 }
      case 'CLEAR_CONFIRM_FLAGGED': return { icon: '✓', cls: 'ok', words: 'Matches — confirm flagged', rank: 3 }
      case 'CLEAR': return { icon: '✓', cls: 'ok', words: 'Everything matches', rank: 3 }
      default: return { icon: '•', cls: 'muted', words: 'Checking…', rank: 4 }
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
    var problems = 0, unread = 0, matched = 0, failed = 0
    rows.forEach(function (r) {
      if (r.state === 'FAILED' || r.state === 'REJECTED') { failed++; return }
      if (r.outcome === 'DISCREPANCIES_FOUND') problems++
      else if (r.outcome === 'INCOMPLETE') unread++
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
      if (!dividerShown && p.rank >= 3) {
        var d = el('li', 'divider', 'Matched')
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
  }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    var ws = new WebSocket(proto + '//' + location.host + '/batch/' + jobId + '/stream')
    ws.addEventListener('message', function (e) {
      try { handleEvent(JSON.parse(e.data)) } catch (err) { /* ignore malformed frame */ }
    })
    ws.addEventListener('close', function () {
      // A closed lid must not lose a job (B7): reconnect and take a fresh snapshot.
      setTimeout(connect, 1500)
    })
  }

  startBtn.addEventListener('click', function () {
    startBtn.disabled = true
    startBtn.textContent = 'Starting…'
    startErr.classList.add('hidden')
    // The server returns the job in flight if there is one, so this is a join
    // rather than a second batch. Nothing here needs to distinguish them.
    fetch('/batch', { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('start failed'); return r.json() })
      .then(function (data) {
        jobId = data.jobId
        batchSection.classList.remove('hidden')
        setButton('running')
        connect()
      })
      .catch(function () {
        setButton('idle')
        startErr.textContent = 'The check could not be started. Nothing was saved. Please try again in a moment.'
        startErr.classList.remove('hidden')
      })
  })

  resetBtn.addEventListener('click', function () {
    var wasRunning = startBtn.disabled
    resetBtn.disabled = true
    resetBtn.textContent = wasRunning ? 'Stopping…' : 'Clearing…'
    fetch('/batch/reset', { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('reset failed'); return r.json() })
      .then(function () {
        resetBtn.disabled = false
        // Clearing a settled job has nothing to broadcast — no item changes
        // state — so the page tidies itself rather than waiting for an event
        // that will never arrive.
        if (!wasRunning) {
          rows.clear()
          batchSection.classList.add('hidden')
          resetBtn.classList.add('hidden')
          setButton('idle')
          resetBtn.classList.add('hidden')
        } else {
          // A running job settles through the coordinator's abort broadcast,
          // which carries a fresh snapshot, so the worklist updates itself.
          resetBtn.textContent = 'Clear results'
        }
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
        if (data.running) { setButton('running'); showMode(false) }
        connect()
      })
      .catch(function () { /* no current job to adopt; the button stands */ })
  }

  bootstrap()

  // Single review is the landing mode: it is the interactive path an agent
  // reaches for, and the batch screen is the demonstration. The bootstrap may
  // still switch to batch if a job is already running, which is the one case
  // where the other screen matters more.
  singleInit()
  showMode(true)

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
    if (outcome === 'INCOMPLETE') return 'warn'
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

  function showMode(single) {
    byId('single').classList.toggle('hidden', !single)
    byId('batchHome').classList.toggle('hidden', single)
    byId('modeSingle').setAttribute('aria-selected', String(single))
    byId('modeBatch').setAttribute('aria-selected', String(!single))
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

  function attach(file) {
    if (!file) return
    attached = file
    byId('pickedName').textContent = file.name
    byId('pickedSize').textContent = (file.size / 1048576).toFixed(1) + ' MB'
    // A thumbnail BEFORE submission: the commonest upload mistake is the wrong
    // file, and finding that out after a five-second wait is a wasted review.
    byId('thumb').src = URL.createObjectURL(file)
    byId('drop').classList.add('hidden')
    byId('picked').classList.remove('hidden')
    clearFieldError('file')
  }

  function detach() {
    attached = null
    byId('file').value = ''
    byId('picked').classList.add('hidden')
    byId('drop').classList.remove('hidden')
  }

  function singleInit() {
    byId('modeSingle').addEventListener('click', function () { showMode(true) })
    byId('modeBatch').addEventListener('click', function () { showMode(false) })

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
  }

  function runSingle() {
    clearFieldError('brandName'); clearFieldError('file')
    byId('singleResult').textContent = ''

    // Validation on submit only, never on blur: flagging an incomplete entry
    // before someone has finished thinking is hostile to a slow typist (§4.5).
    var brand = byId('brandName').value.trim()
    if (!brand) return showFieldError('brandName', 'Please enter the brand name from the application.')
    if (!attached) return showFieldError('file', 'Please add an image of the label.')

    var working = byId('working')
    working.textContent = 'Reading the label…'
    working.classList.remove('hidden')
    var extended = setTimeout(function () {
      working.textContent = 'Still working — this is taking longer than usual.'
    }, 8000)

    var form = new FormData()
    form.append('label', attached)
    form.append('brandName', brand)
    form.append('classType', byId('classType').value.trim())
    form.append('alcoholContent', byId('alcoholContent').value.trim())
    form.append('netContents', byId('netContents').value.trim())

    fetch('/review', { method: 'POST', body: form })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b } }) })
      .then(function (res) {
        clearTimeout(extended)
        working.classList.add('hidden')
        if (!res.ok) {
          if (res.body && res.body.field === 'image') return showFieldError('file', res.body.reason)
          if (res.body && res.body.field === 'brandName') return showFieldError('brandName', res.body.reason)
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
      banner.appendChild(bw)
      sheet.appendChild(banner)
    }

    var layout = el('div', 'layout')
    var left = el('div')
    left.appendChild(el('h2', null, 'Fields'))
    d.fields.forEach(function (f) { left.appendChild(renderField(f)) })
    left.appendChild(renderWarning(d.warning))
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
