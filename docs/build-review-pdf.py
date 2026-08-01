#!/usr/bin/env python3
"""
Build a single review PDF from the design documents.

Markdown → HTML → Chrome headless → PDF. Typeset for reading on screen and on
paper: each document starts on a new page, tables and ASCII diagrams are sized to
fit the measure, and a contents page lists every top-level section.

Usage:
    python3 build-review-pdf.py              # the full set, with cover and contents
    python3 build-review-pdf.py poc-batch.md # one document, standalone

Requires: Google Chrome, and the `markdown` package.
"""

from __future__ import annotations

import html
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

import markdown

HERE = Path(__file__).parent
OUT = HERE / "review"
PDF = OUT / "TTB-label-verification-design.pdf"

# Order matters: this is the reading order for a reviewer who starts at page one.
DOCS = [
    ("design.md", "Software Design", "Requirements, architecture, verification logic, provenance, delivery"),
    ("batch-backend-design.md", "Batch Processing — Backend", "Job orchestration, document normalisation, platform mapping"),
    ("poc-batch.md", "PoC — Batch Processing the Corpus", "Scope, pipeline, measurements, exit criteria"),
    ("deployment-path.md", "From Prototype to Production", "Staged evolution, portability rules, effort"),
    ("deployment-runbook.md", "Deployment Runbook", "Resources, steps, verification, rollback, teardown"),
    ("implementation-plan.md", "Implementation Plan", "Per-milestone stories, traces, and exit criteria"),
    ("ui-design.md", "User Interface", "Personas, screen specification, states, accessibility"),
    ("test-plan.md", "Test Plan", "Unit catalogue, corpus, adversarial cases, model migration"),
    ("project-reference.md", "Project Reference", "Stakeholders, verified agency context, open questions"),
    ("config/warning-statement.md", "Reference Data — Warning Statement", "Statutory constants and comparison rules"),
    ("software-design-document.md", "Appendix — Design Template", "The template these documents were written from"),
]

CSS = """
@page {
  size: Letter; margin: 19mm 16mm 18mm 16mm;
  @bottom-left  { content: "TTB Label Verification — Design Documentation";
                  font-family: -apple-system, Helvetica, sans-serif;
                  font-size: 7pt; color: #9a9aa2; }
  @bottom-right { content: counter(page) " / " counter(pages);
                  font-family: -apple-system, Helvetica, sans-serif;
                  font-size: 7pt; color: #9a9aa2; }
}
/* the cover carries no folio */
@page :first { @bottom-left { content: ""; } @bottom-right { content: ""; } }

* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 9.4pt; line-height: 1.5; color: #1c1c1e;
}

/* ---------- cover ---------- */
.cover { height: 235mm; display: flex; flex-direction: column; justify-content: center;
         page-break-after: always; }
.cover .eyebrow { font-size: 8.5pt; letter-spacing: .16em; text-transform: uppercase;
                  color: #1a4480; font-weight: 700; }
.cover h1 { font-size: 30pt; line-height: 1.1; margin: 10pt 0 6pt; letter-spacing: -.02em; }
.cover .sub { font-size: 13pt; color: #4a4a52; font-weight: 400; }
.cover .rule { border-top: 3pt solid #1a4480; margin: 22pt 0 16pt; width: 90pt; }
.cover dl { display: grid; grid-template-columns: 92pt 1fr; gap: 5pt 14pt;
            font-size: 9.5pt; margin: 0; }
.cover dt { color: #6a6a72; }
.cover dd { margin: 0; }
.cover .note { margin-top: 26pt; font-size: 8.6pt; color: #6a6a72; line-height: 1.55;
               border-left: 2.5pt solid #d8d8dd; padding-left: 11pt; max-width: 118mm; }

/* ---------- contents ---------- */
.toc { page-break-after: always; }
.toc h2 { font-size: 15pt; border: none; margin: 0 0 14pt; padding: 0; }
.toc .doc { margin-bottom: 15pt; }
.toc .doc .t { font-weight: 700; font-size: 10.5pt; }
.toc .doc .d { color: #6a6a72; font-size: 8.8pt; margin-bottom: 4pt; }
.toc .doc ul { margin: 0; padding-left: 15pt; columns: 2; column-gap: 20pt;
               font-size: 8.6pt; color: #3a3a42; }
.toc .doc li { break-inside: avoid; margin-bottom: 1.5pt; }

/* ---------- document sections ---------- */
.doc-start { page-break-before: always; }
.doc-head { border-bottom: 2.5pt solid #1a4480; padding-bottom: 7pt; margin-bottom: 16pt; }
.doc-head .n { font-size: 8pt; letter-spacing: .14em; text-transform: uppercase;
               color: #1a4480; font-weight: 700; }
.doc-head h1 { font-size: 21pt; margin: 5pt 0 2pt; letter-spacing: -.015em; }
.doc-head .d { font-size: 9pt; color: #6a6a72; }

/* the first h1 inside each converted document is redundant with .doc-head */
.body > h1:first-child { display: none; }

h1 { font-size: 16pt; margin: 20pt 0 8pt; }
h2 { font-size: 13pt; margin: 17pt 0 7pt; padding-bottom: 3pt;
     border-bottom: .7pt solid #d8d8dd; page-break-after: avoid; }
h3 { font-size: 10.8pt; margin: 13pt 0 5pt; page-break-after: avoid; }
h4 { font-size: 9.6pt; margin: 11pt 0 4pt; color: #3a3a42; page-break-after: avoid; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
li { margin-bottom: 2.5pt; }
strong { font-weight: 700; }
blockquote { margin: 9pt 0; padding: 7pt 12pt; border-left: 3pt solid #1a4480;
             background: #f4f6f9; font-size: 9.2pt; }
blockquote p:last-child { margin-bottom: 0; }
hr { border: none; border-top: .7pt solid #d8d8dd; margin: 16pt 0; }

/* ---------- tables ---------- */
table { width: 100%; border-collapse: collapse; margin: 8pt 0 11pt;
        font-size: 8.2pt; page-break-inside: auto; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th { text-align: left; background: #eef1f5; border-bottom: 1pt solid #b8c0cc;
     padding: 4pt 6pt; font-weight: 700; font-size: 7.8pt;
     text-transform: uppercase; letter-spacing: .04em; }
td { border-bottom: .5pt solid #e2e2e7; padding: 4pt 6pt; vertical-align: top; }
td code, th code { font-size: 7.6pt; }

/* ---------- code and diagrams ---------- */
code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 8.4pt;
       background: #f0f1f4; padding: .5pt 3pt; border-radius: 2pt; }
pre { background: #f7f8fa; border: .5pt solid #e2e2e7; border-radius: 3pt;
      padding: 8pt 10pt; margin: 9pt 0 11pt; overflow: hidden;
      page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 7.1pt; line-height: 1.32;
           white-space: pre; display: block; }

a { color: #1a4480; text-decoration: none; }
"""


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def convert(path: Path) -> tuple[str, list[str]]:
    """Render one markdown file, returning its HTML and its h2 headings."""
    raw = path.read_text(encoding="utf-8")
    md = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists", "attr_list"])
    body = md.convert(raw)
    headings = [
        re.sub(r"<[^>]+>", "", h).strip()
        for h in re.findall(r"^## (.+)$", raw, flags=re.M)
    ]
    return body, headings


def main() -> int:
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if not Path(chrome).exists():
        print("Chrome not found", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)

    # Single-document mode: no contents page, no "document N of M" banner.
    selected, standalone = DOCS, False
    if len(sys.argv) > 1:
        wanted = set(sys.argv[1:])
        selected = [d for d in DOCS if d[0] in wanted or Path(d[0]).name in wanted]
        if not selected:
            print(f"No such document. Known: {', '.join(d[0] for d in DOCS)}", file=sys.stderr)
            return 1
        standalone = len(selected) == 1

    rendered, toc = [], []
    for i, (rel, title, desc) in enumerate(selected, start=1):
        p = HERE / rel
        if not p.exists():
            print(f"  skip (missing): {rel}")
            continue
        body, heads = convert(p)
        banner = (html.escape(rel) if standalone
                  else f"Document {i} of {len(selected)} &nbsp;·&nbsp; {html.escape(rel)}")
        rendered.append(f"""
<section class="doc-start" id="{slug(title)}">
  <div class="doc-head">
    <div class="n">{banner}</div>
    <h1>{html.escape(title)}</h1>
    <div class="d">{html.escape(desc)}</div>
  </div>
  <div class="body">{body}</div>
</section>""")
        toc.append(f"""
  <div class="doc">
    <div class="t">{i}. {html.escape(title)}</div>
    <div class="d">{html.escape(desc)} &nbsp;·&nbsp; <code>{html.escape(rel)}</code></div>
    <ul>{''.join(f'<li>{html.escape(h)}</li>' for h in heads)}</ul>
  </div>""")
        print(f"  {rel}  ({len(heads)} sections)")

    cover_title = ("AI-Powered Alcohol<br>Label Verification" if not standalone
                   else html.escape(selected[0][1]))
    cover_sub = ("A prototype for TTB label compliance review" if not standalone
                 else html.escape(selected[0][2]))
    eyebrow = "Design Documentation" if not standalone else "Design — for review"
    contents = f'''<section class="toc"><h2>Contents</h2>{"".join(toc)}</section>''' if not standalone else ""

    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>TTB Label Verification — Design</title><style>{CSS}</style></head><body>

<section class="cover">
  <div class="eyebrow">{eyebrow}</div>
  <h1>{cover_title}</h1>
  <div class="sub">{cover_sub}</div>
  <div class="rule"></div>
  <dl>
    <dt>Status</dt><dd>Draft for review — design complete, implementation not started</dd>
    <dt>Compiled</dt><dd>{date.today():%d %B %Y}</dd>
    <dt>{"Documents" if not standalone else "Part of"}</dt>
    <dd>{len(rendered) if not standalone else "TTB Label Verification design set"}</dd>
    <dt>Repository</dt><dd>alcohol-label-verify</dd>
  </dl>
  <div class="note">
    <strong>The model reads. The rules compare. The human decides.</strong><br>
    Extraction is confined to perception; every verdict is computed by
    deterministic code from versioned reference data. The system produces
    evidence for a compliance agent — it does not approve or reject.
  </div>
</section>

{contents}

{''.join(rendered)}
</body></html>"""

    out_pdf = PDF if not standalone else OUT / f"TTB-{slug(selected[0][1])}.pdf"
    src = OUT / "_review.html"
    src.write_text(doc, encoding="utf-8")

    subprocess.run(
        [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--no-pdf-header-footer", "--run-all-compositor-stages-before-draw",
         "--virtual-time-budget=20000", f"--print-to-pdf={out_pdf}", src.as_uri()],
        check=True, capture_output=True)
    src.unlink()

    print(f"\n→ {out_pdf}  ({out_pdf.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
