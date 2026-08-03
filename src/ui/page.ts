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
  .warning-seg { padding: 8px 0; }
  .warning-seg .dev { color: var(--muted); font-size: 15px; }
  .advisory { border-top: 1px solid var(--line); margin-top: 16px; padding-top: 14px; }
  .advisory label { display: flex; gap: 10px; align-items: flex-start; padding: 5px 0; }
  .banner { background: #fdf6e3; border: 1px solid #ecdca6; border-radius: 6px; padding: 10px 14px; font-size: 15px; color: var(--warn); margin-bottom: 16px; }
  .err { color: var(--bad); margin-top: 12px; }
</style>
</head>
<body>
<main>
  <h1>Label check</h1>
  <p class="lede">Check each submission's label artwork against its application record, and verify the government health warning. This produces evidence for review — it does not approve or reject.</p>

  <section id="start">
    <button id="startBtn" type="button">Check the 26 test submissions</button>
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

  <div id="detail" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="detailTitle"></div>
</main>
<script>
(function () {
  'use strict'
  var startBtn = document.getElementById('startBtn')
  var startErr = document.getElementById('startErr')
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
        if (data.running) setButton('running')
        connect()
      })
      .catch(function () { /* no current job to adopt; the button stands */ })
  }

  bootstrap()

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
    layout.appendChild(right)

    sheet.appendChild(layout)
    mount(sheet)
  }

  function mount(sheet) {
    detail.appendChild(sheet)
    detail.classList.remove('hidden')
    document.addEventListener('keydown', onDetailKey)
    detail.addEventListener('click', function (e) { if (e.target === detail) closeDetail() })
    var btn = sheet.querySelector('button')
    if (btn) btn.focus()
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
