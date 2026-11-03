# Safety walls

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
the real project, and never edit code in either source or copy. Symlinks and
special files are refused so a copied link cannot reach back into original data.
Do not bypass this refusal. Isolate local test data as well as application files.

## W3: Seal before report

Copy fingerprints every real file with SHA-256, including files omitted by
`--skip`. Stop your app, then run `seal` before cleanup and report. An added,
changed, or deleted real file produces exit 3 and `REAL PROJECT CHANGED` with the
file names. Stop and inform the owner. Never issue an unchanged/clean report for
that run. Reporting rechecks the receipt's fingerprint after cleanup too.

## W4: Report only

Record holes and advice; never apply repairs. No code edits in the real project,
no Backloop/pipeline status moves, and no Commit, Accept, or Reject. Give generated
output to the reviewer's Break-tries notes. The builder fixes separately; the
owner controls release decisions.

## W5: No temporary run left behind

Stop only the app you started, then use:

```text
node scripts/break-it.mjs cleanup <run-id>
```

It may delete only its own run folder after proving the resolved path is inside
the OS temp directory's `break-it` folder. It refuses outside paths and symlink
traps and leaves sibling runs alone. Confirm the folder is gone. Keep the cleanup
receipt with the intentional findings/report output outside the run; it allows
the report to be generated after the temporary folder has gone. On an interrupted
run, stop your process and use the same cleanup command. Never improvise deletion.

## W6: Nothing leaves this computer

Every request goes only to the copy's localhost port. Never follow a redirect,
download a tool, or contact an external service. Inspect startup behavior first;
disable external integrations through existing local test settings before launch.
Use invented users, isolated local stores, and local test files. Never use real
accounts, shared databases, or production data. If the copy cannot be made fully
local without code changes, stop and explain the blocker. These reviewer checks
are essential: the CLI does not intercept arbitrary app network traffic.

## W7: Hook-friendly commands

Use `node scripts/break-it.mjs` for check, copy, seal, cleanup, and report. Use
Node's standard library for portable data handling. Do not use privileged shell
commands, destructive shell shortcuts, downloaded installers, or Git history
rewrites. No platform-specific shell script is required.
