# Test evidence

How break-it was tested, version by version and round by round. The builder (Codex) built every round; an
independent reviewer (Claude) re-ran the tests on a fresh clone, tried to break it, and gave a verdict. Only the
owner pushed or installed. All runs were on macOS. **Windows has not been tested yet.**

## In one table

| Version | Rounds | Builder commits | Tests at the end | Reviewer verdicts |
|---|---|---|---|---|
| 0.1.0 | **3** (build + 2 fix rounds) | `d580967` → `84f1650` → `ffa8af6` | 75 / 75 | Changes required → Approved with comments → **Approved** |
| 0.2.0 | **1** (build) | `e9c72ff` | 110 / 110 | **Approved** first time |
| 0.3.0 | **3** (build + 2 fix rounds) | `2444790` → `b565245` → `9d4ae88` | 208 / 208 | Changes required → Changes required → **Approved** |

**7 rounds in total, 7 reviews.** Every test count was re-run by the reviewer on Node 18.20.8, 20.20.2 and 22.23.1.

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
