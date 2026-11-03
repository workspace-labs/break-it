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

Use `send` for every try and control request, targeting only the copy's localhost
port. It sends one request with a 5-second deadline, never follows redirects or
retries, caps the entire request body at 64 KiB, and prints at most 2 KiB of the
response body with a plain `(cut)` marker if truncated. It uses the same local URL
check and refusal message as `check --url`. Never follow a redirect,
download a tool, or contact an external service. Inspect startup behavior first;
disable external integrations through existing local test settings before launch.
Use invented users, isolated local stores, and local test files. Never use real
accounts, shared databases, or production data. If the copy cannot be made fully
local without code changes, stop and explain the blocker. These reviewer checks
are essential: the CLI does not intercept arbitrary app network traffic.

## W7: Hook-friendly commands

Use `node scripts/break-it.mjs` for check, copy, send, seal, cleanup, and report. Use
Node's standard library for portable data handling. Do not use privileged shell
commands, destructive shell shortcuts, downloaded installers, or Git history
rewrites. No platform-specific shell script is required.
