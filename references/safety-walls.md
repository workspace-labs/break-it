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
- [W9: Generated files only](#w9-generated-files-only)
- [W10: Bounded bad connections](#w10-bounded-bad-connections)
- [W11: Login values stay hidden](#w11-login-values-stay-hidden)

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

Use `send` for ordinary per-request tries and controls, and `upload` for Family E
file requests, targeting only the copy's
localhost port. `send` makes one request with a 5-second deadline, never follows redirects or
retries, caps the entire request body at 64 KiB, and prints at most 2 KiB of the
response body with a plain `(cut)` marker if truncated. It uses the same local URL
check and refusal message as `check --url`. Never follow a redirect,
download a tool, or contact an external service. Inspect startup behavior first;
disable external integrations through existing local test settings before launch.
Use invented users, isolated local stores, and local test files. Never use real
accounts, shared databases, or production data. If the copy cannot be made fully
local without code changes, stop and explain the blocker. These reviewer checks
are essential: the CLI does not intercept arbitrary app network traffic.
`load` goes through `send` for every burst request and health probe; `upload`
reuses that same transport in `send.mjs`. Only `send.mjs` owns network primitives.
It also owns one raw local socket for `net` only, using `node:net` after the
same URL check and pinned to literal loopback (`127.0.0.1` or `::1`). No other
script imports a network module. `net` has no DNS, proxy, TLS, redirect or retry
path; its same-port GET probes use the existing `send` transport. All other
network-module restrictions stay unchanged; W10 gives the connection bounds.
The optional `send --headers` display shows only bounded Content-Type,
Content-Disposition and Content-Security-Policy values needed for upload reads,
and every Set-Cookie with its value fully masked and flags exact.
That optional block is capped at 2 KiB; `(headers cut; incomplete evidence)`
means its evidence is inconclusive. Upload's body and deadline caps are in W9.

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

Use `node scripts/break-it.mjs` for check, copy, scan, mask, send, load, make,
upload, net, sessions, seal, cleanup, and report. Use
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
A `cancelled at deadline` count is our own cap and is NEVER evidence of a hole;
if those requests need to finish, raise `--duration` (up to 30) and run again.
One final request to the same target checks whether the app still answers after
the burst; it is additional to the burst budget and has its own deadline of at
most 5 seconds. Keep initial tries small and stop on a crash or outage. This
checks resilience, not performance benchmarks.

`load` is report-only: it starts nothing, edits nothing and leaves no file behind.
It prints only a four-line bounded summary and recovery status, never response
bodies. All fields appear, including zeros: sent/completed/failed/cancelled;
2xx/3xx/4xx/5xx/other/no status; completed-request latency; after-burst status.
Cancelled requests appear only in the first line, never a status bucket;
`no status` counts genuine failures, including `send`'s own 5-second timeout.
Use isolated local test data and disposable sessions. A successful bounded burst
on an ordinary route is a safe control and must never be reported as a hole.

## W9: Generated files only

Before any Family E try, find where the copy saves uploads and unpacks archives.
The actual resolved folders must be inside that copy. If configuration points to
an absolute path outside the copy, a cloud bucket or a shared folder, STOP the
family and record each affected try as skipped with the reason. Never let a
try write outside the copy. A copied app is not a filesystem sandbox; establish
its storage behavior before sending a file.

Break-it makes every test file itself through `make`, from a fixed built-in list,
inside `<runPath(id)>/files/`. Never download a payload, create one by hand or
pass a file of your own. The only script marker sets the title to `break-it`;
there are no network scripts. `upload --file` reads only a bare made filename
from that folder, refusing slash, backslash, `..`, missing files and symbolic-link
substitutes. The `--name` option accepts fixed presets only and affects the
multipart part header, never the local input path. Its traversal preset is
exactly one level up: `../break-it-escape-<runId>.txt`.

Large files are streamed, default 20 MiB and hard cap 50 MiB. The ZIP contains
one zeros entry, exactly 100 MiB unpacked, under 1 MiB compressed, never nested.
Try it only when the copy unpacks archives; watch that copy's disk use and
memory and stop on an observed outage. The whole multipart body is capped at
51 MiB. Upload makes one POST or PUT request using send's localhost/literal
loopback transport, no redirects and no retries, with a 5-second deadline.
Only `big` receives a 30-second deadline, stated in the output. Its masked
reply body stays capped at 2 KiB. No input file is held in memory in full.
MiB means 1,048,576 bytes; `--mb N` uses that unit.

After the tries, list any `break-it-escape-*` files inside the copy or its run
folder as E03 evidence. The existing cleanup deletes the made files with the
whole run. Keep findings outside the run, then complete seal, cleanup and report
as usual; do not add a separate deletion command.

## W10: Bounded bad connections

Use `net` only against the owner's throwaway copy on its localhost port, after
one normal `send` to the same route answers. An existing guarded run id and a
`--probe` URL are required. Both URLs must use HTTP, with exactly the same host
and port; the probe is always GET. HTTPS is refused. A command opens one bad
TCP connection, with at most two probes: one during a held `slow` or `short`
connection and one after every kind. Probe failures are measurements.

The only shapes are `cut`, `slow`, `leave`, `short`, `garbage`, `bad-header`,
`huge-header` and `two-lengths`. No free-text raw bytes, repeat loop, retry,
concurrency or TLS is available. The cut point is always half the body rounded
down; the drip rate is one byte every 500 ms; short always sends 10 body bytes.
Only `slow` and `short` accept `--seconds`, whole integers 1–30, default 10.
Every bad connection stops within 30 seconds, including any during probe; the
final probe gets its own deadline of at most five seconds. Fixed broken-request
shapes wait at most five seconds for a reply. Nothing is kept open on return.

A JSON body is capped at 64 KiB. Only `cut` accepts a file, using the same bare
made-name checks and multipart builder as `upload`, capped at 51 MiB. The four
broken-request kinds accept no body option. Bearer validation and the masked
2 KiB reply block match `send`. The command starts no app, writes no file,
retains no response on disk and exits 0 for measurements; refusals are nonzero.

`still open at our limit` is our own cap and is NEVER evidence of a hole on its
own. Default or unknown app limits make this result inconclusive; a SMALL
F02/F04 finding needs code evidence that the relevant app limits are switched
off. Stop on an observed crash/outage and never repeat the damaging try. Use
normal `send` controls before and after the family; keep seal, cleanup and
report unchanged. Family F covers user-side connections only.


## W11: Login values stay hidden

Use Family G only on the owner's throwaway localhost copy, with made-up users.
Bearer keys and session cookie values are never printed or saved in findings,
not even their first/last characters. Show shape only: name, length, flags,
character family and pattern. `send` fully masks JSON login fields and known
login values, and Set-Cookie always hides the whole value, whatever it looks like.

W6 applies to `sessions` too: at most 20 sequential logins via `sendRequest`,
the same localhost pinning, five-second deadline, no redirects and no retries.
Default 10; stop on a failed login or any lockout. Count A09 and G03 together
per disposable user. Sampled values stay in memory only. Salted fingerprints
and lengths, never raw samples, stay in guarded run metadata and then its
cleanup receipt so the report guard can refuse a sampled value after cleanup.
The receipt disappears after a successful report.

`send --jar <run-id>` stores cookies only in that guarded run's jar.json,
using the same run checks as seal. At most 20 cookies, each at most 4 KiB,
returned only to the exact localhost host:port that issued them; Domain never
broadens the target. No free-text cookie option. Cleanup removes the jar with
the entire run. Never inspect or paste its contents as evidence. Forged values
are used for one request only, never saved or printed; the jar stays unchanged.
Only four fixed forge kinds exist, with no JWT payload editing. W7's same
`node scripts/break-it.mjs` entry handles sessions and the jar options.
