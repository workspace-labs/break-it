# Test evidence

How break-it was tested, version by version and round by round. In the historical 0.1–0.4.0 build/review rounds,
the builder (Codex) built every round and an independent reviewer (Claude) re-ran the tests on a fresh clone,
tried to break it, and gave a verdict. Only the owner pushed or installed. The new 0.3.1 local audit below
records its own verification separately; Claude has not reviewed that patch yet.
The 0.4.0 section also records this merge; its independent review is pending.
All runs were on macOS. **Windows has not been tested yet.**

## In one table

| Version | Rounds | Builder commits | Tests at the end | Reviewer verdicts |
|---|---|---|---|---|
| 0.1.0 | **3** (build + 2 fix rounds) | `d580967` → `84f1650` → `ffa8af6` | 75 / 75 | Changes required → Approved with comments → **Approved** |
| 0.2.0 | **1** (build) | `e9c72ff` | 110 / 110 | **Approved** first time |
| 0.3.0 | **3** (build + 2 fix rounds) | `2444790` → `b565245` → `9d4ae88` | 208 / 208 | Changes required → Changes required → **Approved** |
| 0.4.0 | **2** (build + 1 fix round) | `3d609ab` → `07385f6` | 232 / 232 before merge | Approved with comments → **Approved**; merge review pending |

**9 build/review rounds in total, 9 independent reviews.** The historical 0.1.0–0.3.0
test counts were re-run by the reviewer on Node 18.20.8, 20.20.2 and 22.23.1. The
separate 0.3.1 local audit and this merge verification are not counted as independent
reviews; this merge passed 244 tests on each of those Node versions, as recorded below.

---

## 0.1.0 — the safety shell, bad input, other people's data (3 rounds)

### Round 1 — build (`d580967`, 36 tests) → **Changes required**

| # | Break-try | Result |
|---|---|---|
| 1 | `check --url` with example.com, a LAN address, `localhost.evil.com`, `127.0.0.1@evil.com`, `localhost:80@evil.com`, `0x7f000001`, `127.1` | ✅ all refused |
| 2 | `check` on the home folder, `/`, `/etc`, a missing folder | ✅ all refused |
| 3 | Change a real file between `copy` and `seal` | ✅ exit 3, `REAL PROJECT CHANGED`, file named |
| 4 | Swap the run folder for a symlink to a decoy, then `cleanup` | ✅ refused, decoy kept |
| 5 | A run id shaped like a path | ✅ refused |
| 6 | A report with Advice missing | ✅ refused |
| 7 | Shop demo end to end | ✅ critical order hole found, safe route not flagged |
| 8 | A normal Node project with `node_modules/.bin` symlinks | ❌ refused, even with `--skip` |
| 9 | Receipt size on a 3,000-file project | ❌ 342,783 characters on one line |
| 10 | A hand-made receipt with no real run | ⚠️ a clean-looking report printed |

Findings: **F1 🔴** real projects with symlinks refused (the owner's two main apps have 80 and 122) · **F2 🟠** the
receipt is too big for an agent to carry · **F3 🟡** a 0-try report is accepted · **F4 🟡** report labels not lined up.

### Round 2 — fix round 1 (`84f1650`, 59 tests) → **Approved with comments**

F1–F4 **Fixed.** Proof: a real-shaped scratch copy (a real app's `node_modules` plus a built `.app`, 905 MB, 51 links)
copied with `--skip` in 4.5 s and sealed; an escaping link refused by name; a changed link caught; the receipt is a
small file, read and deleted by `report`; a receipt swapped for a symlink refused; all 10 earlier tries held.
Two new 🟡 notes: no `--skip` hint on a refused link inside `node_modules`; an empty temp folder left behind.

### Round 3 — fix round 2 (`ffa8af6`, 75 tests) → **Approved**

Both notes **Fixed**: the refusal now says *"run copy again with --skip"*; after a full run the temp folder is
empty, and a second run's waiting receipt is left alone.

### Agent-level test of the installed 0.1.0

The reviewer used the installed skill through its own SKILL.md, step by step, on a scratch copy of the shop
example: **11 tried, 6 blocked, 5 got through** (1 CRITICAL, 4 SMALL), safe control held, seal unchanged, nothing
left behind. It found more than the scripted demo (3). Four notes came out of it, and they became 0.2.0.

---

## 0.2.0 — four notes from the agent-level test (1 round)

### Round 1 — build (`e9c72ff`, 110 tests) → **Approved**

| # | Break-try on the new `send` command | Result |
|---|---|---|
| 1 | Live and disguised addresses | ✅ all refused |
| 2 | A 302 redirect to example.com | ✅ not followed |
| 3 | A server that never finishes | ✅ stopped at 5.04 s |
| 4 | A 1 MB reply | ✅ cut to 2 KiB with "(cut)" |
| 5 | A 70 KB request body | ✅ refused before sending (the server saw no request) |
| 6 | An unknown option | ✅ refused |

Agent-level re-test with every try through `send` and **no answer comments in the shop app**: the same 5 holes were
found by attacking; the report showed the new **Same cause** line and the **Skipped (not counted)** block.
One cosmetic 🟡 (a missing blank line), folded into 0.3.0.

---

## 0.3.0 — Family C, leaks (3 rounds)

### Round 1 — build (`2444790`, 146 tests) → **Changes required**

| # | Break-try | Result |
|---|---|---|
| 1 | A project with 7 realistic secrets, `scan` | ❌ **2 of 7** found |
| 2 | Search every output for the full planted values | ✅ never present — masking holds |
| 3 | A symlink pointing outside the project | ✅ refused at `copy` |
| 4 | A 2 MiB file holding a secret | ⚠️ skipped |
| 5 | Secrets committed then removed in git history, through `mask` | ⚠️ quoted one found; `.env` one missed |
| 6 | Paste a whole secret into a finding | ⚠️ 2 refused; an unquoted `.env` password **was printed** |
| 7 | `.env.example` with `your-key-here` | ✅ not flagged |

Findings: **F1 🔴** the shared rule only matched quoted values with exact names, so unquoted `.env` lines, camelCase
and prefixed names were missed by `scan`, `mask` and the report guard · **F2 🟡** files over 1 MiB skipped.

### Round 2 — fix round 1 (`b565245`, 188 tests) → **Changes required**

F1 and F2 **Fixed**: 11 of 11 secrets found and masked (unquoted `.env`, `export`, a header, camelCase, prefixed names,
JSON, YAML, Python, one in the middle of a 5.7 MB bundle); the removed `.env` password found in history with commit +
file + line; every pasted shape refused.
But the new parser brought **N1 🔴**: a 2 MiB file with one long line kept `scan` at 100% CPU for over 3 minutes.
Timing showed it quadratic: 25,000 characters 307 ms, 50,000 1,145 ms, 100,000 4,526 ms. Plus **N2 🟡**: one false
alarm, `{ secret: config.secret }`.

### Round 3 — fix round 2 (`9d4ae88`, 208 tests) → **Approved**

Both **Fixed**: a 100,000-character line went from 4,526 ms to **1 ms**; the whole project with the 2 MiB file
scanned in **0.17 s**; a secret after a 1.6 MB base64 run on the same line was found. `config.secret` is no longer
flagged, and `token=abc123def456ghi` still is. All **15** planted secrets found and masked; git history, the report
guard and the shop demo (round 1: 8 tried, 6 holes; round 2: 8 blocked) all held; nothing left behind.

---

## Known limits (written down, not hidden)

- A secret pasted alone in a sentence, with no name like `password =`, cannot be recognised.
- A secret split across two lines is not found.
- A file copy is not an operating-system sandbox: the reviewer must make sure the app runs locally only.
- **Windows not tested.** Every run above was on macOS.


---

## 0.3.1 — local audit and repairs (2026-11-04)

Status: fixes tested; the owner explicitly requested committing and pushing this
patch on 2026-11-04. This update includes the repairs, twelve regression tests,
version 0.3.1 and this test record. No global skill installation was performed.
Claude has not formally reviewed this patch; publishing it does not claim that review.

The owner requested checking and testing the GitHub skill, fixing confirmed problems,
and writing down the fixes with evidence. Source: `workspace-labs/break-it`, clean
`main` at `b59eba7462265d22b36637eee04679ffc190df8f` before edits.
Environment: macOS, Node `v22.14.0`, npm `10.9.2`, Node standard library only.

### F01 — a sensitive parent could hide an inner password

Before: the generic rule treated an object prefix such as `auth={password:` as
one scalar value and advanced past the inner field name. A complete synthetic
password could survive response masking. A short outer prefix could also let
that raw password through the report guard; scan/history checks missed the inner value.

Fix: `scripts/lib/leaks.mjs` recognizes object containers and continues inspecting
inner named assignments. Quoted object keys can contain punctuation, Unicode,
long names and escaped quotes. Mixed arrays retain their existing prefix masking
while exposing later inner assignments to inspection. Consumed array spans prevent
repeated suffix scans. Scalar arrays and brace-wrapped scalar values remain masked;
nested environment/configuration reads and placeholders remain ignored.

Evidence: eight new tests in `tests/leak-nested.test.mjs` cover recognition,
scan, stdin/history masking, report refusal, safe controls, real localhost CLI
response masking and bounded handling of large/malformed prefixes.

- Original implementation: four regression tests failed (`audit-leaks/red.log`).
- A scalar-preservation regression caught during the repair failed, then was
  corrected (`audit-leaks/red-preservation.log`).
- A further arbitrary-quoted-key reproduction failed, then was corrected
  (`audit-leaks/red-container-keys.log`).
- Final focused run, including existing performance cases: **24 passed, 0 failed,
  0 skipped** (`audit-leaks/green.log`).
- Supplemental tester: **1,444 checks passed**, including spacing, nesting,
  arbitrary first keys, scalar/reference controls; no complete synthetic value
  survived. Three malformed-input probes completed in **7–63 ms** on this Mac
  (`workflow-test/nested-adversarial.json`).

### F02 — filenames could forge diagnostic output

Before: source filenames appeared raw in changed-file alarms and link refusals.
A newline could introduce a fake unchanged-status line; an ANSI escape could clear
or alter the terminal display. Missing-path filesystem errors had the same issue.
The seal still exited 3: this was a diagnostic-integrity defect, not a seal bypass.

Fix: `scripts/lib/seal.mjs` and `scripts/lib/copy.mjs` use the existing secret-safe
label formatter for dynamic names. `scripts/break-it.mjs` sanitizes ordinary error
messages too. Deliberate multiline seal alarms retain their layout. Exact filenames
remain unchanged in fingerprint keys; source bytes and cleanup boundaries are preserved.

Evidence: four new tests in `tests/diagnostic-labels.test.mjs` cover changed-file
seal/cleanup alarms, exact fingerprint keys, credential masking in names,
absolute-link refusals and crafted missing paths in check/copy/report.

- Original filename regressions: **2 failed, 1 existing control passed**
  (`audit-seal/red.log`).
- Additional filesystem-error regression: **1 failed, 3 passed**
  (`audit-seal/red-filesystem.log`).
- Focused safety/link/report/receipt verification: **95 passed, 0 failed,
  0 skipped** (`audit-seal/green-filesystem.log`).
- Supplemental tester: three error cases exited 1 with no stdout, raw terminal
  escapes or complete synthetic values (`workflow-test/error-adversarial.json`).

### Complete verification

Evidence folder beside this checkout: `../break-it-review-20261104-evidence/`.
Paths above are relative to that folder. The original skill backup is
`baseline/break-it/`; file hashes are in `baseline-manifests.json`.

Commands from the checkout root, with `TMPDIR` set to the evidence folder's
`temp/` so fixtures and receipts are isolated:

```text
npm test
node --test tests/leak-nested.test.mjs tests/leak-performance.test.mjs
node --test tests/diagnostic-labels.test.mjs tests/safety.test.mjs tests/links.test.mjs tests/skip-hints.test.mjs tests/report.test.mjs tests/receipts.test.mjs tests/receipt-directory.test.mjs
```

- Initial restricted-sandbox run: **193 passed, 15 failed**, all 15 failures were
  localhost `EPERM`; those failures are retained (`tests-before.log`).
- Baseline rerun with localhost permission: **208 passed, 0 failed, 0 skipped**
  (`tests-baseline-localhost.log`).
- Final complete suite with localhost permission: **220 passed, 0 failed,
  0 skipped**, exit 0, approximately **8.06 seconds** (`tests-final.log`).
- Separate tester's full CLI lifecycle: **13 check groups passed**. A synthetic app
  ran only from its copy; redirects stayed unfollowed; invalid findings retained
  the receipt; corrected findings consumed it; a post-cleanup source change
  refused reporting with exit 3. The tester confirmed its child exited and its
  runs/receipts were gone (`workflow-test/result.json`).
- Static skill-audit results are retained as `audit-before.json` and
  `audit-after.json`. The repair report explains remaining heuristic notices.
- Approved documents under `docs/` remain byte-identical. No dependency or
  architecture change. Existing installed skills were inspected but not updated.

Limits: verification ran on Node 22/macOS, not Node 18 or Windows. Synthetic
fixture testing does not prove every possible secret format is detectable or
that arbitrary application startup is isolated. Existing documented scanner
limits continue to apply. Claude's formal review has not been performed. The owner
explicitly authorized commit/push after reading the local repair summary; global
installation remains unchanged.


### Owner-requested commit and push

On 2026-11-04 the owner requested committing and pushing the tested fixes and
updating this file. The publication includes the two repairs described above,
all twelve new regression tests, the 0.3.1 version/changelog update and matching
instruction/reference updates. The baseline, failing reproductions and passing
results are preserved in this record; it is not a claim of a Claude review.

Pre-commit verification: the full `npm test` suite passed again with **220 tests,
0 failures, 0 skipped**, exit 0, approximately **8.22 seconds**
(`tests-pre-push.log` in the local evidence folder). A separate read-only check
found no unrelated additions, real credentials or personal absolute paths in the
new tests or this record. `git diff --check` passed; all approved `docs/` files
remain byte-identical to the base commit. A fresh fetch confirmed `origin/main`
still matched the baseline before the commit. Publication targets
`workspace-labs/break-it` on `main`, using a normal push with no history rewrite. Detailed raw logs and backup copies remain in the
local evidence folder described above; the regression tests are included in Git
so another reviewer can rerun them.


---

## 0.4.0 — Family D, bounded load (2 reviewed rounds, then merge verification)

The two historical build/review results below are recorded from the owner-approved
2026-11-07 merge brief. This merge's results were measured in the merged tree by
Codex; Claude's independent review of this merge is pending.

### Round 1 — build (`3d609ab`, 228 tests) → **Approved with comments**

Family D added bounded localhost load checks through the existing `send` boundary,
four-line summaries and one final health probe. Claude's verdict was **APPROVED WITH
COMMENTS**. Findings: **N1** deadline cancellations could not be distinguished from
an app failure; **N2** redirects had no separate 3xx status bucket.

### Round 2 — fix round 1 (`07385f6`, 232 tests) → **Approved**

Both findings **Fixed** in Claude's review. N1 gained a separate `cancelled at deadline`
count, excluded from transport failures and status totals. N2 gained a 3xx bucket;
other received statuses and genuine `no status` failures stayed separate. Claude
confirmed the N1 regression failed **4/4** runs on `3d609ab` and passed after the fix.
His verdict was **APPROVED**, with no findings. These are the prior round's results,
not a claim that this merge has already been independently reviewed.

### Merge verification — join the owner's 0.3.1 repairs without losing Family D

Clean local `main` began at `07385f6`; a fresh `git fetch origin` confirmed
`origin/main` at `b08e55e`. An ordinary merge produced exactly six conflicts:
CHANGELOG.md, README.md, SKILL.md, package.json, scripts/lib/report.mjs and
tests/report.test.mjs. Version text keeps **0.4.0**; the changelog retains both
release entries verbatim and in date order. The entire 0.3.1 audit section above
is unchanged. No code conflict required a logic resolution.

Builder verification on macOS, using installed Node binaries and separate
`TMPDIR` folders for each suite, ran `node --test` on this same merged code:

- Node **18.20.8**: **244 passed, 0 failed, 0 cancelled, 0 skipped**, exit 0.
- Node **20.20.2**: **244 passed, 0 failed, 0 cancelled, 0 skipped**, exit 0.
- Node **22.23.1**: **244 passed, 0 failed, 0 cancelled, 0 skipped**, exit 0.

All eight `tests/leak-nested.test.mjs` cases and all four
`tests/diagnostic-labels.test.mjs` cases passed in each suite. In the same runs,
`scan` and stdin/history masking caught the nested synthetic credential; the
report guard refused unmasked nested evidence; `send` masked the nested reply;
control-character filenames could not forge diagnostic status lines. The Family D
CLI, ceilings, concurrency, no-redirect, deadline, status and recovery tests also
passed. Thus nested masking and load are exercised together in the merged tree.

Byte comparisons against `b08e55e` found identical `leaks.mjs`, `copy.mjs`,
`seal.mjs`, both new regression files and both updated leak/report references.
The CLI's complete error handler is identical to 0.3.1, including non-seal
`safeLabel(message)` handling; its separate `load` dispatch remains present.
The approved files under `docs/` are unchanged.

`node scripts/demo-shop.mjs` passed again: round 1 **12 tried, 3 blocked, 9 findings**;
round 2 **12 tried, 12 blocked, 0 findings**. Both seals passed and both reports
confirmed cleanup. Its output was byte-identical to `examples/shop-app-report.md`,
so `--write` was not run and the example report was not regenerated.

Evidence beside this checkout: `../break-it-merge-20261107-evidence/`, including
`tests-merged-node18.log`, `tests-merged-node20.log`, `tests-merged-node22.log`,
`demo-shop-output.md`, `preservation-checks.json` and `skill-audit.json`.
The pre-merge Node 22.14.0 baseline passed **232 tests** before any edit.
The static audit retained the known build-folder/discovery-name mismatch
(`break-it-skill` versus `break-it`), an image skipped at its read-size limit,
and a README tool-name heuristic notice. These are not new merge regressions;
no installed skill was changed.

README counts were calculated from the nine `### Round` build/review headings:
3 for 0.1.0 + 1 for 0.2.0 + 3 for 0.3.0 + 2 for 0.4.0. The separate 0.3.1 audit,
agent-level example and pending merge review do not add independent reviews.
Version remains **0.4.0**. This merge is local only: no push, tag, release or
installation change. Claude re-reviews before the owner decides whether to push.

## 0.4.1 — nested secrets under credential names (2026-11-10)

Builder verification by Codex; **delivered for Claude's independent review**.
Baseline: clean `main` at `e78d4fabcd0ec35d391599beb9a2f6366a95ee09`, version
0.4.0. The original 244 tests passed on Node 20.20.2 before production edits,
using `/Users/mohammadaljaziri/.nvm/versions/node/v20.20.2/bin/node --test`.
The runner had discovered the original suite before the new test file was written.
An earlier sandboxed `npm test` had 213 passes and 31 localhost `listen EPERM`
failures; allowing the existing synthetic loopback fixtures resolved those failures.

### Regression evidence and final runs

- Old implementation: the initial 20 nested-parent tests had 2 passes and 18
  expected failures; the performance file had 16 passes and 2 new expected
  failures. Further tests/variants cover quoted assignment text and keys,
  metadata/provider overlap, and scalar fallback beyond depth 64 and within
  prose or after malformed line breaks. Each discovered failure was reproduced
  before its correction. One interim quote-boundary implementation failed the
  existing malformed escaped-key timeout; bounded scalar fallback corrected it.
- Final suite: **244 → 270 tests** (24 new parent tests, 2 new timing tests).
  `node --test`, invoked with each installed runtime's absolute path, passed
  **270/270, 0 failures, 0 cancelled, 0 skipped** on Node **18.20.8**, **20.20.2**
  and **22.23.1**. Environment: macOS / Darwin arm64. Runs used synthetic local
  data and loopback servers; no dependency installation or external target.
- New one-MiB timing cases, measured once per final suite with `performance.now()`
  around `findSecrets` in an isolated child (each limit: **2,000 ms**):
  Node 18: **49.72 ms** for 2,000 sibling parents, **48.54 ms** for depth 64;
  Node 20: **64.18 ms**, **54.79 ms**; Node 22: **61.31 ms**, **57.41 ms**.
- Existing `leak-nested.test.mjs` deep named object/array prefix test remained
  green. Its combined subtest duration was **622.77 ms / 1,157.95 ms / 677.51 ms**
  on Node 18 / 20 / 22; its individual matching assertions retain their 2 s limit.
- Builder-only probe on Node 20.20.2: a minified **2,097,152-byte** input with
  sibling sensitive parents produced **21,846** hits in **109.99 ms**; redaction
  removed every complete planted value. Mismatched delimiters and a JSON-escaped
  metadata key also passed bounded detection/redaction checks.

### Output, preservation and limits

The five previously missed shapes are found and masked; the two existing shapes
remain single hits. Thirteen benign settings produce no confirmed hits. All 16
metadata keys yield masked by-eye evidence when otherwise eligible. Tests cover
one heading per file, correct CRLF line numbers, clean/only-review endings,
provider overlap without downgrading confirmed evidence, history masking,
report refusal of raw evidence, quoted braces/keys, empty-first object arrays,
unclosed parents, depth 64 and scalar fallback deeper than 64, and a parent/value
crossing the one-MiB boundary without duplicate or partial masks.

`send.mjs`, `load.mjs`, `tests/walls.test.mjs`, every pre-existing test except the
timing file, and the approved `docs/` files are byte-identical to the baseline.
Walls tests passed unchanged. No new imports outside the standard library and no
dependencies were added. No package lock exists.

`node scripts/demo-shop.mjs` passed: round 1 **12 tried, 3 blocked, 9 findings**;
round 2 **12 tried, 12 blocked, 0 findings**. Its output is byte-identical to
`examples/shop-app-report.md` (SHA-256
`a80b855f2c73f52e1ab8503c688035c37d022492fd143e5a00f59a9b43277aee`).
The existing report banner still says 0.4.0: the brief requires preserving
messages/report format beyond the by-eye lines, so the interim banner change was
reverted and its existing test retained. Package/README/SKILL/changelog identify 0.4.1.

The static `audit-agent-skills` check of a disposable candidate folder named
`break-it` found **0 structural errors, 4 review notices**: the unchanged hero
image exceeds its one-MiB read limit, README mentions Claude Code, and this evidence
section has a machine-specific runtime path and repeats that tool-name notice.
The first audit, before this evidence section was appended, had only the first
two notices. No installed skill was changed. The metadata list remains incomplete; a secret under `source`
needs by-eye review. Inherited context is bounded to the available text/window
and 64 levels; provider/scalar rules remain independent. Windows was not tested.

Temporary logs: `/private/tmp/break-it-041-baseline-local.log`,
`break-it-041-final-node18.log`, `break-it-041-final-node20.log`,
`break-it-041-final-node22.log`, `break-it-041-red-parent.log`,
`break-it-041-red-performance.log`, `break-it-041-extra-probes.log`,
`break-it-041-demo.log`, and `break-it-041-skill-audit.json` (all under
`/private/tmp`). Reproduce the durable tests with each runtime's `node --test`;
run `node scripts/demo-shop.mjs` for the demo. Local commit only; no push, tag,
release or installation. Next gate: Claude review, then the owner's decision.
