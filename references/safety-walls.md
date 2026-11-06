# Safety walls

## Contents

- [W1: Own project, local only](#w1-own-project-local-only)
- [W2: Attack only the copy](#w2-attack-only-the-copy)
- [W3: Seal before report](#w3-seal-before-report)
- [W4: Report only](#w4-report-only)
- [W5: No temporary run left behind](#w5-no-temporary-run-left-behind)
- [W6: Nothing leaves this computer](#w6-nothing-leaves-this-computer)
- [W7: Hook-friendly commands](#w7-hook-friendly-commands)
- [W8: Bounded load only](#w8-bounded-load-only)

These walls apply to every run, including a retest. The CLI handles file checks,
copying, fingerprints, deletion, and report rendering. The reviewer remains
responsible for proving the app can run locally without touching shared systems;
this portable skill is not an operating-system sandbox.

## W1: Own project, local only

Only the independent reviewer may test the owner's own project. Establish
ownership and reviewer independence from the request; a folder check cannot prove
either. Stop and ask if unclear. `check` refuses home/system roots, missing or
non-folder paths, and non-local URLs. Only localhost, 127.0.0.1, and ::1 hosts are
eligible. A localhost address alone does not prove it is your throwaway app.

## W2: Attack only the copy

Start the app and send every try only from/against the run's `copy` folder.
Use the source path only as input to the CLI's check/copy operation. Never launch
the real project, and never edit code in either source or copy. A copied symbolic
link must retain its relative text and resolve within the project; absolute,
escaping, or unresolvable links are refused by name. A link is never followed to
copy its target. Skipped folders, including their links, are sealed but not copied
or checked for copy eligibility. Special files remain refused. Windows link
creation failures explain permissions/Developer Mode and suggest `--skip`;
never substitute target copying. Isolate local test data as well as app files.

## W3: Seal before report

Copy fingerprints every real file with SHA-256, including files omitted by
`--skip`. It records each symbolic link as a distinct link-text entry without
following it. Stop your app, then run `seal` before cleanup and report. An added,
changed, or deleted file or link produces exit 3 and `REAL PROJECT CHANGED` with
the names. Stop and inform the owner. Never issue an unchanged/clean report for
that run. Reporting rechecks the receipt's fingerprint after cleanup too.

## W4: Report only

Record holes and advice; never apply repairs. No code edits in the real project,
no Backloop/pipeline status moves, and no Commit, Accept, or Reject. Give generated
output to the reviewer's Break-tries notes. The builder fixes separately; the
owner controls release decisions.

A whole secret value is never printed, saved, or reported. Use first 3 characters,
then `…`, then last 4, followed by the length; values of 8 characters or fewer use
`•••• (N chars)`. The report guard refuses matching unmasked values in findings
or skipped text. Do not work around it by changing the spelling or encoding.

## W5: No temporary run left behind

Stop only the app you started, then use:

```text
node scripts/break-it.mjs cleanup <run-id>
```

It may delete only its own run folder after proving the resolved path is inside
the OS temp directory's `break-it` folder. It refuses outside paths and symlink
traps and leaves sibling runs alone. Confirm the folder is gone. The CLI stores a
receipt outside that run at `break-it/receipts/<run-id>.json`, with the same
symlink checks as the temporary base. Cleanup prints only its path. Report reads
it by run id and deletes the receipt after successful validation; only then can
the report say nothing is left behind. A failed report retains the receipt for a
retry. No receipt body belongs in findings JSON. On an interrupted run, stop your
process and use the same cleanup command. If the run is already gone and you
abandon its pending report, cleanup with that run id deletes only its guarded
receipt. After deletion the CLI attempts to remove the empty receipts folder
without recursion. A nonempty or busy folder stays; the shared base is never
removed. No other run's files are deleted.
Never improvise deletion.

## W6: Nothing leaves this computer

Use `send` for every per-request try and control request, targeting only the copy's
localhost port. It sends one request with a 5-second deadline, never follows redirects or
retries, caps the entire request body at 64 KiB, and prints at most 2 KiB of the
response body with a plain `(cut)` marker if truncated. It uses the same local URL
check and refusal message as `check --url`. Never follow a redirect,
download a tool, or contact an external service. Inspect startup behavior first;
disable external integrations through existing local test settings before launch.
Use invented users, isolated local stores, and local test files. Never use real
accounts, shared databases, or production data. If the copy cannot be made fully
local without code changes, stop and explain the blocker. These reviewer checks
are essential: the CLI does not intercept arbitrary app network traffic.
`load` goes through `send` for every burst request and health probe; it adds no new network primitive.

Leaks are inspected only in the copy. Use `scan` for files and copy-local logs;
it reads text in bounded 1 MiB windows with 4 KiB overlap, up to 20 MiB per file,
and names files above that cap as skipped. It never follows a symbolic link.
Pipe copy-local git history directly into `mask` without displaying or saving raw
history. Never send a candidate key to a provider to check it. Mask before any
output or evidence storage, including local notes; keeping a secret on this
computer is still a leak. Use field names rather than copying private reply data.
`send` masks detected secret values before CLI display. This is pattern-based;
do not display arbitrary secret-bearing data through another tool or save raw
responses as evidence.

## W7: Hook-friendly commands

Use `node scripts/break-it.mjs` for check, copy, scan, mask, send, load, seal, cleanup, and report. Use
Node's standard library for portable data handling. Do not use privileged shell
commands, destructive shell shortcuts, downloaded installers, or Git history
rewrites. The one plain-git exception reads history from the copy and pipes it
straight into `mask`, as shown in C02. No platform-specific shell script is required.

## W8: Bounded load only

Use `load` only against the owner's throwaway copy's localhost port, after proving
that it is the copy you started. It uses the same URL check and non-localhost
refusal as `send`; it never follows redirects. Hard ceilings are concurrency
≤ 50, burst requests ≤ 2,000 and burst duration ≤ 30 seconds. Values above the
ceilings or malformed options are refused. Without `--duration`, the burst still
has a 30-second hard stop; stop at the first request or duration limit reached.
In-flight burst requests are cancelled at the duration cap.
One final request to the same target checks whether the app still answers after
the burst; it is additional to the burst budget and has its own deadline of at
most 5 seconds. Keep initial tries small and stop on a crash or outage. This
checks resilience, not performance benchmarks.

`load` is report-only: it starts nothing, edits nothing and leaves no file behind.
It prints only a bounded summary and recovery status, never response bodies.
Use isolated local test data and disposable sessions. A successful bounded burst
on an ordinary route is a safe control and must never be reported as a hole.
