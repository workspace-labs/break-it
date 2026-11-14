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

### 0.4.1 fix round 1 — default nested values to by-eye (2026-11-10)

Builder verification by Codex, delivered for Claude's re-review of F1 (ordinary
settings falsely confirmed) and F2 (stale report banner). This subsection
supersedes the original delivery's metadata-list classification and banner note
above; that earlier record is retained as history. Version remains **0.4.1**.

Start: clean `main` at `d0a6072dfdb0cc7687024e0a54ba06f46478a984`.
Before production edits, installed Node **20.20.2** ran `node --test`:
**270 passed, 0 failed, 0 cancelled, 0 skipped**. The runner discovered those
270 tests before the new regression file was written. A prior restricted run
on Node 22.14.0 found 239 passes and 31 localhost `listen EPERM` failures;
the permitted synthetic loopback run established the green baseline.

Old-code proof: the new classification tests and updated banner expectation
ran against the old implementation: **35 passed, 22 expected failures** out of
57. A later empty-key array regression failed **1/28** before distinguishing an
absent key from an actual empty string. Both failures were corrected. The final
focused run passed **82/82**. No trap or timing assertion was relaxed.

Final full suites (`node --test`, each installed runtime's absolute path,
separate `TMPDIR` per runtime, macOS / Darwin arm64): **270 → 298 tests**.

- Node **18.20.8**: **298 passed, 0 failed/cancelled/skipped**, exit 0, **42.79 s**.
- Node **20.20.2**: **298 passed, 0 failed/cancelled/skipped**, exit 0, **40.24 s**.
- Node **22.23.1**: **298 passed, 0 failed/cancelled/skipped**, exit 0, **43.50 s**.

The suites ran concurrently. Unchanged one-MiB timing tests retained their
**2,000 ms** matching limits: sibling parents / depth 64 measured
**310.48 / 200.50 ms** on Node 18, **58.33 / 40.16 ms** on Node 20,
**72.63 / 36.04 ms** on Node 22. The unchanged deep named-prefix regression
(`leak-nested.test.mjs`, originally line 88) passed both individual `< 2 s`
assertions on every runtime; combined subtest durations were **3,112.51 /
606.46 / 2,203.08 ms**, including both inputs and concurrent-run contention.

The 28 new tests cover the ordinary auth fixture and real scan output, four
extra settings false alarms, all 12 exact value-like names with uppercase and
near-match controls, seven required confirmed shapes, `pass` and `argon`,
object-key inheritance through arrays, empty-string keys, nested by-eye values,
and GitHub/OpenAI/AWS/JWT/private-key provider evidence inside by-eye settings.
Claude's fixture contains nine strings total: `jwt` fails the unchanged length
filter; all **eight eligible strings** are masked by-eye, **zero confirmed**,
and scan ends `No confirmed secrets — check the values above by eye`.
A clean folder still prints `No secrets found`.

Existing test changes are limited to three tests in
`leak-nested-parent.test.mjs`: the 13-settings test now asserts the complete
eligible key list; the `items` array case moved from its confirmed-only loop to
explicit by-eye coverage; quoted field-like notes now assert one confirmed plus
one masked by-eye value while keeping the unrelated-tail checks. The report
shape test expects banner 0.4.1. The old metadata sample list remains only in
tests to preserve coverage of all 16 previously reviewed settings names.

Offline builder-assistance probes passed **11/11 groups**: realistic auth/OAuth/
cloud settings, mixed and deep arrays, closing/malformed/unclosed boundaries,
empty keys and long inputs. A **2,097,200-byte** minified fixture with **26,215**
parents produced **26,215 confirmed + 26,215 by-eye** with no raw values in
**664.72 ms**; unclosed 40,000 fields took **465.28 ms**; 100,000-deep mismatched
nesting took **139.10 ms**. These Node 22.14.0 totals include find, review,
redact, merged evidence and assertions; they are builder probes, not Claude's
independent review.

`node scripts/demo-shop.mjs --write` passed: **12/3/9**, then **12/12/0**.
The banner appeared in `examples/shop-app-report.md`; regeneration changed
only its first-line version from 0.4.0 to 0.4.1. No other CLI wording changed.
Provider confirmation and shared mask/report wiring remain in place.
Production metadata classification is removed: eligible non-value-like,
non-sensitive keys now go to by-eye. A real secret under `pass` or `argon`
therefore needs human inspection; it is never silently dropped.

Evidence and full pre-edit backup: `../break-it-041-fix1-20261110-evidence/`.
Logs: `tests-final-node18.log`, `tests-final-node20.log`,
`tests-final-node22.log`, baseline/RED/focused logs, `demo-shop.log`,
`coverage-map-break-tries.{mjs,log,json}` and before/after static skill audits.
The original scan/mask/report command wiring, network/load/copy/seal code,
`tests/walls.test.mjs`, `leak-nested.test.mjs`, `leak-performance.test.mjs`,
`package.json`, `SKILL.md` and approved `docs/` are byte-identical to `d0a6072`.
No dependencies, push, tag, release or installation. Windows not tested;
existing quoted-string, depth-64 and bounded-window limits remain unchanged.

Static skill re-audit: **0 structural errors, 4 review notices** before and after,
with exactly identical finding records (existing oversized hero image, README
agent-name notice, historical machine path and historical agent-name notice).
No installed mirror was updated. Audits use disposable folders named `break-it`
to preserve the skill's discovery identity; baseline manifest and backup hashes
match the original tracked files. This is static evidence, not runtime review.

## 0.4.2 — plural credential names (2026-11-10)

Builder verification by Codex, delivered for Claude's independent review.
Started on clean `main` at `bdbec3db8b395527c7585872f4538b1ee7fc9d38`.
Before any edits, installed Node **20.20.2** ran `node --test`: **298/298 passed**,
zero failures, cancelled or skipped. The first sandboxed attempt discovered
298 tests but had 31 `listen EPERM` failures; the permitted synthetic-loopback
run established the green baseline. No test assertions were changed for that.

The baseline on Node **18.20.8** and **22.23.1** was checked after implementation
edits, against an archived copy with all 68 tracked files verified byte-identical
to the starting commit: both passed **298/298**, zero failures or skips.

Before the name-rule edit, the new plural regression file ran against the old
implementation: **97 tests, 22 passed, 75 expected failures**. After the explicit
plural additions, the focused plural/classification/report run passed **155/155**.
The new file adds **97 tests**, including all 15 missed names in JSON, env,
YAML-style scalar and JavaScript forms; remaining compact/plural-pair spellings;
three already-caught names without duplicates; 13 required look-alikes plus
`auths`, `tokenss`, `secretss`; nested confirmation and by-eye classification;
scan/mask/report wiring; and the documented tokenizer-array false positive.

Final full suites used each installed runtime's absolute path with `--test`
and a separate evidence-local `TMPDIR` (macOS / Darwin arm64):

- Node **18.20.8**: **298 → 395**, all 395 passed, zero failures/cancelled/skipped.
- Node **20.20.2**: **298 → 395**, all 395 passed, zero failures/cancelled/skipped.
- Node **22.23.1**: **298 → 395**, all 395 passed, zero failures/cancelled/skipped.

All existing timing tests passed unchanged. Final suite durations were
39.889 s / 39.040 s / 44.568 s respectively. The existing one-MiB stress
diagnostics and limits are retained in the full logs; no timing assertion was
relaxed. The Node 18/22 archived baseline suites ran concurrently; final suites
ran one runtime at a time, with later baseline reruns overlapping Node 22.

`node scripts/demo-shop.mjs --write` passed: round 1 **12 tried, 3 blocked,
9 findings**; round 2 **12 tried, 12 blocked, 0 findings**. Only the example's
first-line version changed, from 0.4.1 to 0.4.2. No production logic changed
outside `sensitiveName()`; the report module changed only its banner. All other
original test content, approved `docs/`, network/load/copy/seal code and walls
remain byte-identical to the starting commit.

Additional synthetic break-tries: **27 passed** for mixed-case and separated
plural names, environment/dotted reads, GitHub Actions-style templates,
placeholders, false pluralizations, parent closing boundaries, by-eye-only
inner keys, repeated masking and short reply values. These are builder probes,
not Claude's independent review. The tokenizer limit is intentionally retained:
the compact `tokens` word-list example is one confirmed scalar-array candidate,
including the trailing outer brace, just as for the singular control.

Static skill audit: **0 structural errors, 4 existing review notices**, with
unchanged findings from the baseline. Discovery identity is preserved in
disposable collection folders named `break-it`. No installed copy was changed.

Evidence and pre-edit Git archive: `../break-it-042-20261110-codex-evidence/`.
Logs: `baseline-node20-loopback.log`, `baseline-node18-loopback.log`,
`baseline-node22-loopback.log`, `plural-red.log`, `plural-green.log`,
`final-node18.log`, `final-node20.log`, `final-node22.log`, `demo-shop.log`,
`break-tries.json`, `preservation-check.json`, and baseline/final skill audits.
No dependencies, push, tag, release or installation. Windows was not tested;
the existing string parsing, depth-64 and bounded-window limits are unchanged.


## 0.4.3 — list values end at their matching bracket (2026-11-10)

Builder verification by Codex, delivered for Claude's independent review.
Started on clean `main` at `29bc728d25b4db9ce3f366fe2c726502035be9cc`;
`origin/main` was the same commit. The initial sandboxed Node 22.14.0 baseline
found 395 tests: 364 passed, 31 failed because localhost listeners were denied
(`listen EPERM`). No assertions were changed to accommodate the sandbox.
An archived copy of the exact starting commit subsequently passed **395/395**
on installed Node **18.20.8**, **20.20.2** and **22.23.1**, zero failures or skips.
Those permitted synthetic-loopback baseline runs used the archive after working-tree
edits began; the archive remains the unchanged pre-edit source.

Before the scanner edit, the first 22 new functional tests ran against the old
implementation: **4 passed, 18 expected failures**. Both new timing tests also
failed their result assertions on the old implementation. Two additional edge
regressions (assignment-like unquoted elements, punctuation/inherited keys) were
checked afterwards against the archived old scanner: **0 passed, 2 failed**.
The final list/performance run passed **44/44**.

The new file `tests/leak-list-values.test.mjs` adds **24 tests**; the performance
file adds **2**. Every requested table row is covered, plus line numbers,
unquoted placeholders, nested lists, object-list classification, unclosed input,
escaped strings, a one-MiB window boundary, element redaction, CLI scan output,
and an embedded assignment that must not consume the closing bracket or sibling.
The old `arrayEnd` scalar-list branch was removed; all lists use the existing
64-frame walk and `containerEnd` protection. Unquoted element spans also bound
scalar fallback, preserving normal scanning after the list.

Full suites used each installed runtime's absolute path with `--test`, one final
runtime at a time, with the existing synthetic localhost tests permitted:

- Node **18.20.8**: **395 → 421**, all 421 passed; zero failures, cancellations or skips; 40.428 s. New one-MiB minified lists **93.60 ms**, 64-deep unclosed lists **126.08 ms**.
- Node **20.20.2**: **395 → 421**, all 421 passed; zero failures, cancellations or skips; 39.274 s. New one-MiB minified lists **74.70 ms**, 64-deep unclosed lists **104.94 ms**.
- Node **22.23.1**: **395 → 421**, all 421 passed; zero failures, cancellations or skips; 39.898 s. New one-MiB minified lists **80.69 ms**, 64-deep unclosed lists **96.36 ms**.

Both new timing checks retain the **2,000 ms** limit. All original timing inputs,
limits and assertions remain unchanged and pass; their diagnostics are in the
full-suite logs. The minified list record is 47 bytes; the unclosed case includes
many interior sensitive names beyond 64 frames to exercise no-rescan behavior.

Existing test updates, and why:

- `tests/leak-plural-names.test.mjs`: the plural secrets-list test now expects
  its single element and `generic nested secrets`, instead of the swallowed
  array-plus-brace span. The tokenizer-limit test now expects only
  `understanding` (13 chars), retaining the honest long-word false positive.
- `tests/report.test.mjs`: expected first-round banner becomes 0.4.3.
- `tests/leak-performance.test.mjs`: only the two new fixtures/checks were added;
  no pre-existing timing assertion was weakened.

`node scripts/demo-shop.mjs --write` passed: **12 tried / 3 blocked / 9 got
through**, then **12 / 12 / 0**. The regenerated example differs only on its
first-line version banner. All approved `docs/`, walls, traps, plural-name rules,
confirm/by-eye rules, network/load/copy/seal modules and every other untouched
tracked file were compared with the starting commit. No dependency was added.

Additional builder break-tries: **25/25 passed**, covering parent spellings,
minified/multiline separators, closing brackets and commas inside strings,
repeated redaction, unquoted references, inherited by-eye keys, mismatched closes,
quoted bracket text and named-credential fallback beyond the frame cap.
A separate helper code check reproduced the unquoted-assignment fallback issue;
the bounded-token correction and regression pass. Claude's independent review
is still pending.

Static skill audit: **0 structural errors, 4 existing review notices**, unchanged
codes, locations and messages from baseline: oversized hero asset, model-specific
tools in README/evidence, and a historical personal path. Disposable collection
folders named `break-it` preserve discovery identity; no installed copy changed.

Known limits: this remains a string-aware heuristic tokenizer, not a language
parser. Long ordinary quoted words under `tokens` remain findings. A bracket-index
environment expression such as `password: [process.env["LONG_ENV_NAME"]]` may
still flag the index name as a nested string; dotted `[process.env.A]` is ignored.
The existing 64-frame, scalar and 4-KiB window-overlap limits remain; Windows was
not tested. No AST parser or additional reference form was introduced.

Evidence and pre-edit archive: `../break-it-043-20261110-codex-evidence/`.
`break-it-043-baseline-node{18,20,22}.log`, `break-it-043-list-red.log`,
`break-it-043-performance-red.log`, `break-it-043-extra-red.log`,
`break-it-043-list-green.log`, `break-it-043-final-node{18,20,22}.log`,
`break-it-043-demo-shop.log`, `break-it-043-break-tries.json`,
`final-results.json`, `preservation-check.json`, baseline/final skill audits,
`baseline-29bc728.tar` and `pre-edit-backups/` contain the builder evidence.
One local commit only; no push, tag, release or installation.


### 0.4.3 fix round 1 — unquoted elements require a closed list (2026-11-10)

Builder: Codex. Reviewer: Claude. F1 is **CORRECTED / DELIVERED FOR RE-REVIEW**;
Claude's independent decision is pending. Started on clean `main` at
`edc3a43379dcd25b144ec744ac936cdfb203c43b`. Version remains **0.4.3**.
Before any edits, installed Node **22.23.1** passed the **421/421** baseline.
The exact archived starting commit also passed **421/421** on Node **18.20.8**
and **20.20.2** after working-tree edits began, with zero failures or skips.
All full suites permitted only the existing synthetic-loopback tests.

Root cause: the nested walk published unquoted words immediately, even if their
array never closed. Each tracked array frame now holds its unquoted candidates,
already classified as confirmed or by-eye, and publishes them only at its own
matching `]`. End-of-text and mismatched closes discard still-held candidates;
crossing the 64-frame cap invalidates still-open frames because delimiter types
beyond the cap are not tracked. Already closed inner frames retain their values.
Quoted-element code is byte-identical to the starting commit.

Unquoted token spans also share only a small boolean closure state with their
frame. Scalar fallback checks it so an embedded `password=...` cannot revive a
dropped element. Closed-list fallback remains available. Pending candidates
belong to their frame; neither state references nor span metadata retain pending
arrays. There is no extra text pass or container rescan; `containerEnd` remains.

RED before the scanner edit: **21 functional tests, 5 passed / 16 failed**;
the new two-MiB timing fixture failed with **105,969 false hits in 168.68 ms**.
GREEN: focused list/plural/nested/classification/timing run **215/215**.
The new functional file adds **21 tests**, and performance adds **1**:

- Node **18.20.8**: **421 → 443**, all 443 passed, zero failures/cancelled/skipped; 39.701 s. Two-MiB unclosed prose: **0 hits, 194.28 ms**; original list stress cases: **100.44 ms** minified and **118.59 ms** deep/unclosed.
- Node **20.20.2**: **421 → 443**, all 443 passed, zero failures/cancelled/skipped; 39.201 s. Two-MiB unclosed prose: **0 hits, 198.11 ms**; original list stress cases: **75.02 ms** minified and **106.71 ms** deep/unclosed.
- Node **22.23.1**: **421 → 443**, all 443 passed, zero failures/cancelled/skipped; 39.857 s. Two-MiB unclosed prose: **0 hits, 184.22 ms**; original list stress cases: **81.79 ms** minified and **97.62 ms** deep/unclosed.

Every timing assertion retains its existing limit, including **2,000 ms** for the
new two-MiB case. Existing functional tests are unchanged. The only pre-existing
test file edited is `tests/leak-performance.test.mjs`: one new input mode and one
new test; the new mode returns hit count rather than over 100,000 masks so RED can
fail on its zero-hit assertion. All older output fields and assertions remain.

The exact SETUP.md fixture now returns **No secrets found** via real `scan`, with
zero confirmed and zero by-eye values from the library. Closed unquoted lists,
closed inner/open outer lists and unclosed quoted values remain found. Unclosed
and mismatched unquoted lists, by-eye candidates and assignment-like elements
are dropped. Tests cover depth 64, overflow followed by later closes and an
unclosed list crossing the one-MiB scan window.

`node scripts/demo-shop.mjs --write` passed **12/3/9**, then **12/12/0**. Its report
is byte-identical to the base. All approved docs, protected modules, wall/trap
tests, 0.4.3 list tests, plural and confirm/by-eye rules remain byte-identical to
`edc3a43`. Only the same 0.4.3 changelog entry is updated; package and banner remain
unchanged. The reference now explains closed-list handling and OAuth scope-list
false positives such as `allowedTokens: ["read:orders"]`.

Additional builder break-tries: **20/20 passed**, including prose/markdown/regex
stray brackets, nested closure/mismatch, inherited by-eye, cap invalidation and
150,000 closed unquoted elements. A separate helper code check passed **66/66**
focused tests and **15/15** additional probes, including 130,000 closed elements,
closed-list comparisons against base and scalar-fallback controls. These are
builder-side checks, not Claude's independent re-review.

Static audit: **0 structural errors; the same 4 pre-existing review notices**
with unchanged codes/locations/messages. Evidence:
`../break-it-043-fix1-20261110-codex-evidence/` contains base archive and backups,
`break-it-043-fix1-baseline-node{18,20,22}.log`, `unclosed-red` and `performance-red`
logs under the same prefix, final full-suite logs for all three versions, focused,
demo, break-tries, helper checks, preservation hashes and baseline/final audits.
One additional local commit only; no push, tag, release, dependency or installation.
Existing tokenizer, quoted-value, frame-cap and scan-window limits still apply;
Windows was not tested.

## 0.4.4 — indented YAML credential blocks (2026-11-10)

Builder verification for the owner's YAML repair brief, starting on clean `main`
at `df6be62299276a4da6c5c3285dd7e175c1996bf9` (0.4.3). One local commit is
requested; no push, tag, release, installation or dependency change.

### Before and after

The shared generic detector skipped newline-only sensitive assignments before
considering indentation. Y1–Y6 now use a bounded YAML-shaped block walk: scalar
mapping leaves use their nearest key; bare list elements are confirmed when
eligible. Non-value-like leaves remain masked by-eye. Dedents and code-shaped
lines stop inheritance, comments and blank lines do not, and trailing plain
comments are excluded from evidence. Each hit points at its own value's line.

The existing `placeholder`, `sensitiveName`, `valueKeys` and `nestedValues` rules
are unchanged. In particular, Y5's plain `shop.example.com` stays quiet as an
unquoted dotted reference; `callbackUrl` goes by-eye, with zero confirmed hits.
Inline flows retain their YAML field's key through a virtual object frame;
a bounded envelope stops at the real flow close or a YAML sibling. Comments
inside that envelope become spaces for the existing walk, preserving offsets.
The outer block records consumed spans and permits only flow/depth-cap scalar
fallback, without rewalking nested sensitive headers.

### Tests and results

All runs below used the installed runtimes sequentially, with `node --test`.
The synthetic localhost tests need loopback listening permitted. The first
sandboxed baseline reported 412 pass / 31 fail, all failures caused by
`listen EPERM`; the authorized rerun passed. No test was disabled or relaxed.

- Node **18.20.8**: baseline **443/443**, final **468/468**, 0 failures/skips.
- Node **20.20.2**: baseline **443/443**, final **468/468**, 0 failures/skips.
- Node **22.23.1**: baseline **443/443**, final **468/468**, 0 failures/skips.

Node 22's baseline ran in the original checkout before source changes. Node
18/20 baselines ran from an archive of exact `df6be62` in the evidence directory.
The final suites ran against this checkout. The final count adds 23 tests in
`tests/leak-yaml-blocks.test.mjs` and two timing cases in
`tests/leak-performance.test.mjs`.

The initial YAML RED run was 2 pass / 15 fail before implementation. All 23
final YAML tests were also run against the archived baseline (see
`final-yaml-on-baseline-red.log`). During implementation, edge tests caught
quoted-scalar fallback, flow key classification, unclosed-flow boundaries,
depth-cap scalar fallback, comment overrun and doubled-single-quote truncation.
These now have retained tests. The first full Node 22 run caught an existing
multiline-list regression (461/462); its unchanged test passes in the final run.

Only one existing expectation changed: `tests/report.test.mjs` now expects the
0.4.4 banner. The performance file adds fixtures, compact output for those
fixtures, and two assertions/tests without changing existing cases. Every
other pre-existing test file is byte-identical to the baseline.

### Timing

Each new input is exactly 1 MiB; each test requires under **2,000 ms** with the
correct hit count. Times are one measured matching run per final suite:

- Node 18: **102.74 ms** for 20,000 sibling sensitive blocks; **12.26 ms** for
  one sensitive block nested 64 levels.
- Node 20: **81.54 ms** siblings; **10.26 ms** depth 64.
- Node 22: **87.02 ms** siblings; **10.58 ms** depth 64.

All existing matching timing tests also passed their original limits, including
unclosed-list prose and regex stress; the separate full-file scan kept its
original ten-second bound.

### Demo, break-tries and preservation

`node scripts/demo-shop.mjs --write` passed: **12 tried / 3 blocked / 9 got
through**, then **12 / 12 / 0**. The generated report differs only in its banner.

Retained YAML tests cover Y1–Y6 through the real scan, complete masking and value
line numbers, Docker Compose, Kubernetes, Rails exactly once, dedents, comments,
placeholders/env reads, Python/code-shaped lines, CRLF/tabs, block scalars/PEM,
1 MiB overlap, nearest keys, flow comments and limits. Builder-only probes add
GitHub Actions, Ansible, Markdown front matter, internal flow comments, repeat
redaction and **300 generated nested mappings** with comments/dedents. All pass;
probe artifacts store only masked candidates. An initial probe line expectation
was corrected from 6 to 5 after counting the synthetic fixture's actual lines.

Byte comparisons against `df6be62` verify the unchanged original docs, network,
load, copy, seal, scan-window code and walls test. The brace/list walk,
placeholder function and sensitive-name/plural rule are unchanged. Static skill
metadata/resource audits found the same four pre-existing review warnings in
baseline and candidate: oversized hero image skipped, two Claude Code mentions,
and a personal path in historical evidence. No hard structural failure or new
warning was found. The skill description is unchanged; no installed copy changed.

### Limits and evidence

This remains a heuristic, not a YAML parser. Block scalar bodies are ignored by
the generic block walk; provider patterns still detect PEM keys. Tabs count as
one unit, mixed indentation can end a block early, depth stays capped at 64,
and context beyond the retained 4 KiB scan overlap is not carried to the next
1 MiB window. Independent Claude review and fresh-clone verification remain
pending; these results are builder verification.

Temporary evidence: `/private/tmp/break-it-044-evidence/` contains
`baseline-node18.log`, `baseline-node20.log`, `baseline-node22.log`,
`final-node18.log`, `final-node20.log`, `final-node22.log`, RED/focused logs,
`demo-shop.log`, `break-tries.mjs`, `break-tries.json`, skill audit JSON and
`preservation.json`. Reproduce the suites with each runtime's `node --test`,
the focused YAML suite with `node --test tests/leak-yaml-blocks.test.mjs`, and
the example with `node scripts/demo-shop.mjs --write`.

### 0.4.4 fix round 1 — nearest YAML list keys and literal plain text (2026-11-10)

Builder: Codex. Reviewer: Claude. F1 and F2 are corrected and delivered for
independent re-review; Claude's decision is pending. Started on clean `main` at
`20d7ba93b5faaacb1946bcaa7a5adb5bbfd5f0d0`. Version remains **0.4.4**.
Before edits, Node **22.23.1** passed the **468/468** baseline with synthetic
localhost listening permitted. The initial sandbox run found all 468 tests but
reported 437 pass / 31 fail because localhost listeners returned `listen EPERM`.
No assertions were weakened or skipped to accommodate that restriction.

Each YAML indentation frame now retains its opening key. A bare list element
inherits the nearest frame key; list mapping entries retain their own key.
Ordinary `scopes` and `allowedOrigins` lists become masked by-eye, including
Markdown front matter through real `scan`. Root, `primary`, Compose
`API_TOKENS` and Y3 lists remain confirmed. Only plain values inside the YAML
block reader switch to literal-text placeholder filtering, so letters-only and
dotted strings count. Placeholder/template/environment-read skips remain.
The preceding 0.4.4 section describes the original delivery: this subsection
supersedes its bare-list and dotted-value classification statements.

RED, before the scanner edit: **41 YAML tests, 27 passed / 14 failed**.
After F1 alone: **35 passed / 6 failed**, with only F2 expectations still failing.
After F2: **41/41 passed**. The file adds **18 regression tests**; three existing
expectations change intentionally:

- Y5 now includes `issuer: shop.example.com` by-eye, because plain block text is
  literal. Its shared scan assertion also checks this extra by-eye item.
- The nested-frame test moves the list beneath `source:` from confirmed to
  by-eye under the nearest key.
- The filter test confirms `value: config.secret` inside a block, while keeping
  its environment reads quiet.

All final full suites used the installed runtime's absolute path with `--test`:

- Node **18.20.8**: **468 → 486**, **486/486 passed**, zero failures/skips/cancellations; **40.207 s**.
- Node **20.20.2**: **468 → 486**, **486/486 passed**, zero failures/skips/cancellations; **40.186 s**.
- Node **22.23.1**: **468 → 486**, **486/486 passed**, zero failures/skips/cancellations; **40.356 s**.

The recorded starting baseline was Node 22; the 468 → 486 counts on Node 18/20
compare the starting suite size with their verified final runs. Node 20 and 22
partly overlapped. All existing timing fixtures and limits are unchanged and
green. The one-MiB YAML sibling/depth diagnostics were **103.45 / 11.09 ms** on
Node 18, **89.95 / 7.61 ms** on Node 20, and **84.17 / 13.28 ms** on Node 22,
each below the existing **2,000 ms** limit with the required hit count.

`node scripts/demo-shop.mjs` passed **12 tried / 3 blocked / 9 got through**,
then **12 / 12 / 0**. The example report was not rewritten. Retained tests cover
the requested scopes/origins/front-matter cases, preserved confirmed lists,
mixed sibling frames, own-key mapping entries, letters-only/dotted values,
quiet placeholders, CRLF/tabs, Python/Ruby/Actions guards, and unchanged env,
single-line YAML, brace/list and JS handling.

Additional builder probes passed **48/48**: four sensitive roots, five nearest
keys with quoted/plain alphabetic items, nested ancestor overrides, own-key
mapping overrides, empty list mapping frames, root-list restoration, whitespace
filtering, full redaction and repeated masking. A read-only helper's **15/15**
additional probes passed, including deep dedents and the 64-frame boundary.
These are builder checks, not Claude's independent re-review.

Preservation checks compare all **67 tracked files outside the five authorized
files** byte for byte with `20d7ba9`. Every production byte outside
`yamlValues()` is unchanged, including `placeholder()`, `sensitiveName()`,
`valueKeys`, the brace/list walk, YAML guard, flow handoff and scalar fallback.
No network/load/copy/seal code, walls test, timing test, dependency, approved
workflow document, package version or installed skill copy changed.

Evidence and pre-edit backups are in
`/private/tmp/break-it-044-fix1-20261110-evidence/`: `baseline-20d7ba9.tar`,
`pre-edit/`, `plan.md`, `baseline-node22.log`, `baseline-sandbox-denied.log`,
`yaml-red.log`, `yaml-f1.log`, `yaml-green.log`, `final-node18.log`,
`final-node20.log`, `final-node22.log`, `demo.log`, `break-tries.mjs`,
`break-tries.json`, `preservation.json`, and baseline/final static audit JSON.
The audits retain the same four pre-existing review notices with zero structural
errors or new findings. No push, tag, release, installation or dependency change.
The existing heuristic, whitespace, block-scalar, indentation, depth and scan
window limits remain; Windows was not tested. Single-line YAML and `.env`
letters-only/dotted reference skips remain a documented known limit.

### 0.5.0 fix round 1 — download paths and streamed upload bytes (2026-11-13)

Builder: Codex. Reviewer: Claude; independent re-review remains pending.
Started on clean `main` at `6c5f17124ba14b30eb51c82c4797b02e2f277107`.
Version remains **0.5.0** with a fix-round line in its existing changelog entry.
The repository backup and all logs are in
`/private/tmp/break-it-050-fix1-evidence/`.

Clean baselines passed **516/516** on Node **18.20.8**, **20.20.2** and
**22.23.1**. The first restricted run could not open localhost sockets; the
authorized runs enabled only the test fixtures' required loopback access.
The first Node 18 baseline, run alongside Node 20, failed the existing
`leak-nested.test.mjs` timing assertion (3,140 ms against its 2,000 ms limit).
The untouched archived baseline passed all 516 when run alone (41.974 s).
No timing limit, scanner implementation or assertion was changed.

Final full suites ran sequentially with each installed runtime's `node --test`:

- Node **18.20.8**: **516 → 523**, **523/523 passed**, 42.627 s.
- Node **20.20.2**: **516 → 523**, **523/523 passed**, 42.131 s.
- Node **22.23.1**: **516 → 523**, **523/523 passed**, 42.309 s.

All final runs had zero failures, skips and cancellations. The seven added
tests are one E08 documentation test, one shop parent with three scenario
subtests, and two upload reporting tests. Existing expectations were extended
for E08, shifted source anchors, the 18-try demo counts and the new streamed-byte
metadata; no existing coverage was removed or weakened.

Before implementation, both new upload regressions failed: the 413 reply still
printed `uploaded 20971520 bytes`, and streamed-byte metadata was absent.
The focused upload run then passed **3/3**. Documentation tests first failed
on missing E08; docs plus unchanged walls then passed **7/7**. The new shop
guard-only test first observed **200 instead of 400**, then the shop file passed
**16/16**. Logs: `upload-{red,green}.tap`, `docs-{red,green}.tap`,
`shop-guard-red.tap` and `shop-green.tap`.

The shop tests see actual source bytes for both `..%2Fserver.mjs` and
`%2E%2E%2Fserver.mjs` in round 1. They see HTTP 400 with the download path guard
on and ownership off, and with both guards on. A benign `..notes.png` upload
and read succeeds in every scenario. The existing normal-PNG owner read and
cross-user refusal still pass. The upload-name switch now rejects exact `.`
and `..` segments while allowing that benign basename; separators remain refused.
`node scripts/demo-shop.mjs --write` regenerated the checked-in report from real
output: **18 tried / 4 blocked / 14 holes**, then **18 / 18 / 0**. E08 evidence
contains only the filename and HTTP statuses, never source contents.

A separate disposable localhost upload probe recorded an immediate HTTP 413:
`sent 655360 of 20971520 bytes (stopped at the app's reply)`; its completed
20 MiB control printed `uploaded 20971520 bytes`. The full multipart body was
20,971,729 bytes, proving its framing is excluded from the displayed file count.
The count measures client-stream bytes submitted to the existing request pipe,
not proof of server storage. The probe sealed the original unchanged, stopped
its server, and removed its run, receipt and synthetic source. Reproduce with
`upload-probe.mjs`; output is in `upload-probe.json` in the evidence directory.

Builder break-tries include both E08 spellings, guard-only versus owner-guard
scenarios, the benign dotted-name control, repeated early refusals, a delayed
refusal body, complete and empty uploads, and all existing safety/walls tests.
Additional encoded-backslash, double-encoded and two-parent manual probes were
not run; those remain challenges for Claude's independent review. Windows was
not tested. Existing lexical-path and scanner limits remain unchanged.

The static skill audit retained the same **four pre-existing review notices**,
with zero structural errors and no new finding codes. `preservation.json`
records the byte comparison against the baseline. Every tracked file outside
the 16 scoped files is unchanged, including the approved docs, `package.json`,
file generator, leaks/load/copy/seal code and `tests/walls.test.mjs`. Only the
existing shared request transport gained a streamed-chunk counter; no alternate
transport, CLI command, cap, preset or dependency was added. Nothing was pushed,
tagged, released or installed; installed skill mirrors were not updated.

## 0.6.0 — Family F, bad network connections (2026-11-14)

Builder: Codex. Reviewer: Claude; independent review remains pending.
Started on clean `main` at `83c393b088a33b19c384ed1df0ff1bcc2c7b154a`.
This is the compatible Family F addition, version **0.6.0**. Only local commits
are authorized; no push, tag, release or installed-skill update was performed.

### Baseline and full suites

Before implementation, the Node **20.20.2** baseline passed **523/523**, with
zero failures/skips/cancellations, in **41.897 s**. The first sandboxed run on
the default Node 22.14.0 could not listen on localhost (`listen EPERM`); the
baseline rerun enabled the disposable test servers' required loopback access.
The baseline command was the installed Node 20 runtime followed by `--test`.

Final complete suites ran sequentially on macOS using each installed runtime's
absolute path and `--test`, with the same localhost access:

- Node **18.20.8**: **547/547 passed**, **59.817 s**.
- Node **20.20.2**: **547/547 passed**, **59.220 s**.
- Node **22.23.1**: **547/547 passed**, **59.766 s**.

Every final suite has zero failures, skips and cancellations. The increase is
**24 tests**: 23 in `tests/net.test.mjs` and one new W10 transport-wall check.
All 523 earlier tests remain, with release-version assertions updated and shop
expectations extended for the eight new connections. W6 only stops forbidding
`node:net` inside `send.mjs`; its other restrictions remain. W7 admits `net`.
The additional W10 assertion locates the one raw connect after URL validation,
HTTP-only validation and literal loopback pinning.

### Behavior and failure checks

The initial `cut` CLI test failed against the previous Usage refusal before
implementation. The new shop anchor test likewise first failed for the absent
complete-upload switch. The command's options/refusals, eight exact wire shapes,
JSON byte boundary, made-file multipart framing and symlink refusal are covered
by retained tests. Raw code lives in `send.mjs`; options and summaries live in
`network.mjs`; `withUploadBody` reuses upload's existing guarded file handling
and multipart builder. Existing send/upload regression tests passed **28/28**.

Local capture servers verify fixed half-body and ten-byte cuts, the 500 ms drip,
FIN/close, one bad connection and at most two GET probes, actual probe overlap,
no redirects/proxy use, masked and capped replies, chunked response decoding,
reset/early-response measurements and closure at the fixed five-second and real
thirty-second limits. A silent app with silent probes returns in about six
seconds for a one-second try, including the final five-second probe, with every
client socket side closed. The Node 18 real thirty-second test took **30.097 s**
including CLI startup/probe/fixture checks.

Builder read-only inspection found two reply-reader edge cases: a nonstandard
600 status was hidden, and a prematurely ended Content-Length body lacked a
cut marker. Both were corrected; retained tests cover status 600 and partial
bodies at EOF and at the deadline. Parser-owned read limits identify our own
closure; `leave` deliberately observes no peer reply, so its closed outcome with
`we closed: yes` records our departure, not proof of an app reaction. Docs direct
the reviewer to the probes and action read-back. Two initial raw-capture fixture
assertions counted an empty cancelled probe as a second bad connection; the
fixture now distinguishes sockets carrying actual try bytes. Final suites pass.

### Shop and report

`node scripts/demo-shop.mjs --write` regenerated the report from real output on
Node 20 in **4.40 s** wall time. Round 1: **26 tried / 9 blocked / 17 got through**.
Round 2: **26 tried / 26 blocked / 0 got through**. Existing A–E findings and safe
controls are preserved. The three additional SMALL findings are F01, F02 and
F04; F02/F04 point to one disabled-time-limit cause. F03 and all four F05 kinds
stay blocked in both rounds. The focused shop tests passed **16/16**.

F01 first uploads the complete generated 102,039-byte archive, accepted below the
round-2 one-MiB limit, then cuts the same upload. Round 1 keeps/serves a shorter
file; round 2 retains the prior complete file. F03 uses the synthetic shop's
small per-user `/notes` create/read-back fixture to prove zero or one completed
action. Round 2 uses 350 ms headers, 600 ms requests and a 50 ms connection
checking interval; both held connections end before our one-second demo cap.
All answer anchors stay outside the app and identify actual source lines.

### Preservation, audit and limits

The approved `docs/` files remain byte-identical to `83c393b`. File generation,
leak matching, copy/seal/cleanup, load behavior and dependencies are unchanged.
The raw socket is the only new transport, within the single authorized W6
exception. No outside-service checks or roadmap promise were added.

Read-only static audits of baseline/candidate snapshots under the discoverable
folder name `break-it` each report zero structural errors and the same four
existing notices: the large hero image is skipped, README/evidence contain
model-specific mentions, and historical evidence contains a personal path.
The checkout's owner-chosen folder name `break-it-skill` alone produces a name
mismatch when audited in place; no installed folder was renamed or changed.
The optional Python quick validator could not run because PyYAML is absent;
no dependency was installed. Metadata, references and safety walls passed the
Node audit and repository checks.

Evidence is in `/private/tmp/break-it-060-evidence/`: baseline archive/log,
`final-node18.log`, `final-node20.log`, `final-node22.log`, transport/shop/demo
logs, baseline/candidate static audits and `preservation.json`. Reproduce with
each Node runtime's `--test`, or run `node scripts/demo-shop.mjs --write`.
These are builder checks, not Claude's independent acceptance. **Windows was
not run**: no Windows socket timing, process lifecycle, path or full-suite claim
is made. Existing scanner and filesystem-isolation limits still apply.
