# Break-it · 0.6.0

![break-it: find the hole a hacker would find, first](media/break-it-hero.png)

Before release, let the **reviewer** try to break your own app on a throwaway
local copy. Break-it helps find bad-input failures and cases where one user can
read another user's data. Family C also finds leaked keys/passwords in files and
old git commits, replies that expose private fields, errors that reveal internal
details, and logs that keep private data. Family D helps you see if your app
survives many users at once, safely, on a throwaway copy. Family E checks bad
file uploads: files that are too large, pretend to be images, have awkward
names, contain a harmless script marker, expand when unpacked, are broken, or
can be read by the wrong user, plus reading outside the upload folder through
the download address. Break-it makes every test file itself, within
fixed size limits. Family F checks a user with a bad connection: they send
only half a request, send it slowly, leave early, promise more than they send,
or send a broken request. It checks whether the app still answers other users
and whether anything was half-saved. Each try is one fixed, bounded local
connection. It reports what happened, where, and what to fix.
The builder fixes the holes; Break-it never fixes them.

For Claude Code, Codex and other agents that read Agent Skills. Requires Node
18 or newer. Tested on macOS; Windows is not tested yet. There are no packages to install.
The owner chose `break-it-skill` as this build folder; the skill's discovery name
is `break-it`. A future installation should use a folder named `break-it` to match
that name. This build does not install itself into any agent's skill collection.

## Three-step quick start

1. Open this folder with your reviewer agent, and ask it to read `SKILL.md`.
   Tell it: “Run break-it on my project before release,” with your local folder
   and the intended change. Confirm you own the code and the reviewer did not
   build it. The skill is delivered here; it has not been installed globally.
2. The reviewer checks the target, makes a sealed copy, runs applicable tries
   against that copy, stops its app, checks the seal and cleans up.
3. Read the report. Pass the advice to the builder, then have the reviewer repeat
   on a fresh copy. Only the owner decides whether the project is ready.

For a self-running teaching example, open a terminal in this folder:

```text
node scripts/demo-shop.mjs
```

This starts only temporary copies on a free loopback port. It tests bad-input,
access-control, leak, bounded-load, upload and bad-connection cases with safe
controls, simulates builder fixes in synthetic scratch source,
then tests a fresh copy again. Nothing in your real project is changed.

## The walls

- Your own local project only, used by an independent reviewer.
- Attack only a throwaway copy. Links must stay inside it; special files are refused.
- A fingerprint checks every real file and link, including skipped folders.
- Reports contain advice. No real code edits, status moves or owner gate actions.
- A whole secret is never printed, saved or reported; evidence uses masked values.
- Stop the app you started, then let the CLI delete only that run folder.
- Keep data and app integrations local; `send` makes one bounded localhost request.
- `load` checks resilience on that copy only: at most 2,000 burst requests,
  50 in flight and 30 seconds, followed by one health probe.
- Uploads use only files made by Break-it inside that temporary run. Check
  first that the app saves and unpacks uploads inside its copy; otherwise skip
  the family with a reason.
- Bad connections use one fixed HTTP connection and required same-port health
  probes. Break-it stops it within 30 seconds, with at most five more seconds
  for the final probe, and leaves nothing open.
- Run the portable Node commands. No downloaded tools or dependencies.

A copy is not an operating-system sandbox. Before starting any real app, verify
it uses isolated local configuration, synthetic accounts and local data only.
Disable its external integrations in the copy. If that cannot be done safely,
stop. A local folder check cannot prove ownership or detect every mounted share.

## Commands

Run from the skill folder. Quote paths containing spaces on either platform.

```text
node scripts/break-it.mjs check "PROJECT_FOLDER" --url http://localhost:4000
node scripts/break-it.mjs copy "PROJECT_FOLDER"
node scripts/break-it.mjs scan RUN_ID
node scripts/break-it.mjs send POST http://localhost:4000/login --json '{"user":"A","password":"invented"}'
node scripts/break-it.mjs send GET http://localhost:4000/orders/6 --token LOCAL_TEST_SESSION
node scripts/break-it.mjs load GET http://localhost:4000/health --requests 20 --concurrency 2 --duration 1
node scripts/break-it.mjs make RUN_ID normal-png
node scripts/break-it.mjs upload RUN_ID POST http://localhost:4000/upload --file normal.png --token LOCAL_TEST_SESSION
node scripts/break-it.mjs send GET http://localhost:4000/uploads/normal.png --headers --token LOCAL_TEST_SESSION
node scripts/break-it.mjs make RUN_ID medium-png
node scripts/break-it.mjs upload RUN_ID POST http://localhost:4000/upload --file medium.png --token LOCAL_TEST_SESSION
node scripts/break-it.mjs net RUN_ID cut POST http://localhost:4000/upload --probe http://localhost:4000/health --file medium.png --token LOCAL_TEST_SESSION
node scripts/break-it.mjs net RUN_ID slow GET http://localhost:4000/health --probe http://localhost:4000/health --seconds 2
node scripts/break-it.mjs scan RUN_ID
node scripts/break-it.mjs seal RUN_ID
node scripts/break-it.mjs cleanup RUN_ID
node scripts/break-it.mjs report RUN_ID "FINDINGS_FILE.json"
```

`copy` prints a fresh run id. The copy lives under your OS temporary directory at
`break-it/<run-id>/copy`. Default: copy every file. Optional `copy ... --skip`
excludes directories named node_modules, .git, dist, build, out, coverage and
.next; the real seal still covers them. Missing files or changed bytes make
`seal` exit 3 with **REAL PROJECT CHANGED** and the affected filenames. The seal
records link text without following it. Copy preserves safe relative links;
absolute links, links leading outside the project, and links whose targets cannot
be resolved are refused by name. Links inside skipped folders are only sealed.
If Windows cannot create a link, the refusal explains the permission or Developer
Mode requirement and suggests `--skip`; it never copies the target instead.

Run `scan` before starting the copy and again after the tries. It checks files
inside that run's copy, including app-written logs; `.git`, binaries and symbolic
links are skipped. Text files up to 20 MiB are read in 1 MiB windows with 4 KiB
overlap, so a key near a window boundary is reported once with its actual line.
Files larger than 20 MiB get a named skip note. A candidate too long to retain
across a window boundary also makes that file a named skip, rather than showing
a truncated value. Treat skipped files as untested. Output has only the relative
filename, line, pattern name and masked value, plus a masked “Check by eye” list
for settings-like values beneath credential names. Read that list too. With only
by-eye items it ends with `No confirmed secrets — check the values above by eye`;
with neither hits nor by-eye items it prints `No secrets found`. Exit 0 describes
the inspected text, not proof of complete safety.
See [the exact patterns and limits](references/leak-patterns.md). Documented
placeholders such as `.env.example` with `KEY=your-key-here` stay unflagged; that
filename does not excuse a real-looking secret.

The shared generic rule recognizes quoted or unquoted `.env`, configuration and
header assignments, including names such as `DB_PASSWORD`, `client_secret`,
`accessToken` and `apiKey`. Code that reads an environment variable, template
references, placeholders and prose without an assignment are ignored. The same
rule protects history masking and report evidence; see the exact rules above.
Nested string values inherit sensitivity from a parent such as `password`,
within its matching container. Exact value-like or sensitive inner keys confirm
eligible values; other keys, including `pass` and `argon`, go to the masked by-eye
list. Bare array elements without their own key stay confirmed; arrays beneath an
object field keep that field's key rule. Lists are read element by element through
the matching `]`, including multi-line and unquoted flow-style elements; brackets
inside strings do not end the list. Each eligible element is masked on its own,
and fields after the closing bracket are still scanned. See the four checks and limits in the
pattern reference. Seal and copy diagnostics escape filename control characters so names cannot forge status lines.

For C02, read the copy's history with plain git and pipe it straight into `mask`:

```text
git -C "<copy>" log -p --all --no-color | node scripts/break-it.mjs mask
```

Never display or save raw history. `mask` reads at most 20 MiB, notes when the
cap stops it, and prints only masked hits with the nearest commit (7 characters)
and file path plus the historical line from patch hunk counters. Missing git or
a copy without `.git` means C02 is skipped with a
reason. Check git's exit status too. Do not count a failed or capped history read
as proof that all history is clean. See [Family C](references/attacks-leaks.md).

Masking uses the first 3 characters + `…` + last 4 with the length, such as
`sk-…a91f (51 chars)`. Values of 8 characters or fewer use `•••• (N chars)`.
Never check whether a key works by calling its provider. Do not put whole secret
values in findings; the report guard refuses matching unmasked evidence.

Use `send` for each try and control request against that copy's port. Each command
sends exactly one request, with a 5-second deadline and no redirects or retries.
`--json` sends the supplied text as-is (including deliberately malformed JSON);
the entire UTF-8 body, including its JSON envelope, must fit within 64 KiB.
`--token` adds a disposable local bearer session. Output is the HTTP status and
up to 2 KiB of response body, with detected secrets masked before CLI display
and `(cut)` when truncated. A timeout or unseen
response content is inconclusive, never evidence of a hole by itself.
Optional `--headers` prints only bounded Content-Type, Content-Disposition and
Content-Security-Policy values, so the reviewer can check how an uploaded file
is served without exposing other response headers. This optional block has its
own 2 KiB cap; `(headers cut; incomplete evidence)` means the headers cannot
establish the result of a try.

[Family E: bad files](references/attacks-files.md) adds `make` and `upload`, plus
E08 for reading outside the upload folder with the existing `send GET`.
Before these tries, find the copy's actual upload folder, including any archive
extraction folder. If it points outside the copy, to a cloud bucket or to shared
storage, stop this family and record why it was skipped. Break-it cannot sandbox
an app's storage; confirm this before sending any file.

`make RUN_ID KIND` creates one fixed test file under that run's `files/` folder
and prints its name, byte count and description. Available kinds are
`normal-png`, `medium-png`, `big`, `fake-image`, `html-script`, `svg-script`,
`zip-bomb`, `empty` and `truncated-png`. Never download a test file, build one by hand or
provide a file of your own. The script examples only change the document title
to `break-it`. `big --mb N` streams zeros, defaults to 20 MiB and cannot exceed
50 MiB; MiB is 1,048,576 bytes. The ZIP is under 1 MiB and contains one fixed
100 MiB zeros entry, never nested. Skip that try unless the app unpacks archives.

`upload RUN_ID POST URL --file MADE_NAME` sends one streamed multipart file.
PUT is also allowed. The file name must be bare and refer to a file made in that
run; paths, `..`, and symbolic-link substitutes are refused. `--field` defaults
to `file`; `--type` changes the claimed content type; `--token` uses a disposable
local bearer as with `send`. `--name` takes only the presets `traversal`,
`null-byte`, `long`, `arabic`, `emoji`, and `reserved`, never arbitrary text.
These change only the filename sent in the multipart header; the traversal
preset goes exactly one level up, using a run-specific marker name.

The whole upload body, including framing, cannot exceed 51 MiB. It retains
send's literal-loopback connection, no redirects or retries, masked 2 KiB reply
and a 5-second deadline; only `big` gets a stated 30-second deadline. Use
`send GET` for the returned local address to check script-serving headers and
whether B can read A's private file. E08 tries both `..%2F<file>` and
`%2E%2E%2F<file>` against the download address, only for a known harmless file
exactly one level above uploads and inside the copy. Never target system files
or anything outside the copy; report only the status and file name, not content.
A valid PNG that its owner uploads and
reads normally is a safe control. After the tries, record any
`break-it-escape-*` files inside the copy or run folder as traversal evidence.
Cleanup deletes all made files with the run; there is no separate cleanup step.

After the individual tries, [Family D](references/attacks-load.md) uses `load` to
check crashes under many users, missing limits on sensitive routes, errors that
appear only with concurrent requests and failure to recover. It reuses `send`;
the URL must still name the throwaway copy on localhost. Start small and stop
on an outage. This is resilience testing, not a performance benchmark.

`--requests` accepts 1–2,000 (default 200), `--concurrency` accepts 1–50 (default
10), and optional `--duration` accepts 1–30 seconds. The burst stops at whichever
limit comes first, with a 30-second hard stop even without `--duration`. Body
and bearer options are the same as `send` and are reused for each request.
In-flight burst requests are cancelled at the duration cap. One final health
request to the same route runs afterward with its own deadline of at most 5
seconds, additional to the burst request budget. Output stays at four bounded
lines with sent/completed/failed/cancelled counts, status totals, latency for
completed burst responses and whether that final probe answered; it never prints
response bodies. Every field appears, including zeros. For example:

```text
LOAD GET http://localhost:4000/x  requests: 3  completed: 0  failed: 0  cancelled at deadline: 3
status: 2xx 0  3xx 0  4xx 0  5xx 0  other 0  no status 0
latency ms: min n/a  median n/a  p95 n/a  max n/a  (completed requests)
after burst: app answered 200
```

A `cancelled at deadline` count is break-it's own limit and is NEVER evidence of
a hole; if you need those requests to finish, raise `--duration` (up to 30) and
run again. Cancelled requests appear only in the first line. The status tally
groups completed responses into 2xx, 3xx, 4xx, 5xx and other (below 200 or 600+);
`no status` counts genuine failures, including `send`'s own 5-second timeout.
Requests means actually sent; the duration limit can stop a burst before its
requested budget is exhausted. Sent = completed + failed + cancelled; the final
probe is separate.
The command starts nothing, edits nothing and leaves no file behind. A normal
route that stays healthy through the burst is a safe control, never a hole.

After Family E and before the final log scan, [Family F](references/attacks-network.md)
uses `net RUN_ID KIND METHOD URL --probe URL` to check a user's bad connection.
First establish that a normal `send` to the same route answers; use a normal
`send` again after the family as a safe control. `--probe` is required, always
GET, and must use the same host and port as the target. Only `http://` is
supported; the socket is pinned to a literal loopback address, without DNS,
proxy, TLS, redirects or retries. Each command is one logical try. Stop on an
observed crash/outage and never repeat the damaging try.

The fixed choices are `cut` (exactly half a body, rounded down), `slow` (request
line/headers one byte per 500 ms), `leave` (full request then leave without
reading), `short` (exactly 10 body bytes then silence), and `garbage`,
`bad-header`, `huge-header`, `two-lengths` (fixed broken requests). No raw-byte,
repeat or concurrency option is available. Only `slow` and `short` accept
`--seconds`: whole integers 1–30, default 10. `short` requires a `--json` body
over 10 bytes; all JSON bodies have the same 64 KiB cap as `send`. Only `cut`
accepts `--file`, using upload's guarded made file and shared multipart builder,
with a 51 MiB total cap. First confirm that a full upload would be accepted and
that storage is inside the copy. Use the harmless 100 KiB `medium-png` for a
cut upload so the cut reaches file content. The four broken-request kinds accept no body.
`--token` uses send's existing validation.

Every command opens one bad connection plus at most two normal probes. A probe
runs during `slow`/`short` while the connection is held and after every kind,
through send's five-second deadline. The connection stops within 30 seconds;
the final probe has at most five additional seconds. Broken-request replies
wait at most five seconds. No socket or file is left behind. Output always
shows bytes sent, elapsed time, app reaction and both probes; `probe during`
is `n/a` for other kinds. App answers use send's masked Status/body block capped
at 2 KiB. Probe failures and all app behaviors are measurements; the command
exits 0 when the try ran, nonzero only for refusals. A during-probe cancelled
when the try ends prints `stopped when the try ended after <T> s (not evidence)`;
this is break-it's own limit, never evidence. If its answer is needed, run again
with a larger `--seconds`. Only genuine failures say `app did not answer`.

`still open at our limit` is break-it's own cap and is NEVER evidence of a hole
on its own. For slow/incomplete requests, default or unknown app limits mean
inconclusive. A SMALL finding needs code evidence that the relevant limits are
switched off; a failed probe needs an established app outage/cause. Read back
created data or inspect copy-local storage to check half-saved or duplicate work.
For `leave`, the app line is `app: not observed (we left first)` because no
peer reply or reaction is observed. Judge the app through its probes and normal
`send` readback. Family F covers the user's connection only.

After stopping your app, run seal, then cleanup. Cleanup prints only the path of
a receipt file under `break-it/receipts` in your OS temporary directory, outside
the deleted run. Report finds it by run id, checks that the run is gone and the
real project is still unchanged, then deletes the receipt after success. The
agent never has to carry a large receipt or put it in findings. Failed reports
keep it so corrected findings can be retried. See [the report format](references/report-format.md).
If you abandon a pending report after its run is gone, use cleanup with the same
run id to delete only that receipt. The CLI then attempts to remove the empty
receipts folder without recursion; a nonempty or busy folder stays. The shared
break-it temporary base is kept.
Keep findings outside both source and run so they do not change the seal or get
deleted. Cleanup on a changed source removes its own copy but exits 3 with no
report receipt. Preserve the alarm; never turn it into a clean report.

The CLI is a safety shell with bounded secret-pattern checks, not a complete
security scanner. The agent adapts the [bad-user](references/attacks-bad-user.md),
[access-control](references/attacks-other-data.md),
[leak](references/attacks-leaks.md), [load](references/attacks-load.md),
[bad-file upload](references/attacks-files.md), and
[bad-network connection](references/attacks-network.md)
try lists to the intended change.
Count completed tries, including safe controls; put inapplicable ids and reasons
in the optional findings JSON `skipped` list and disclose inconclusive tries in
review notes. Skips never change counts. Findings at the same file and line get
a same-cause note. A report needs at least one completed logical try.
A passing run proves only what was tried.

## Example: orders, leaks, load and uploads

The full [generated report](examples/shop-app-report.md) is real CLI output.
Round 1 demonstrates another customer's order, input/login failures, a fake key
kept in configuration, a profile reply exposing a password-hash field, and an
error revealing internal details. It also demonstrates a route that fails under
a small burst, fails its recovery probe, and an unlimited login route. A healthy
normal route stays unflagged. Upload cases demonstrate an oversized file,
a one-level traversal name, inline script content and another user's private
file, while a valid image for its owner stays unflagged. Bad-connection tries
find a half-kept upload and switched-off connection limits; leaving early and
all four broken-request shapes stay blocked in both rounds. Round 2 repeats the
tries on a fresh copy of the harness's fixed scratch source and finds no remaining holes. The original
example app is untouched.

Every finding includes Tried, Saw, Where and Advice. Secret evidence is masked;
private fields can be named without copying their values. The safe order route
must block the other user's record, and `.env.example` stays unflagged.
The example does not claim C02/C05 or E02/E05/E06 coverage; those are exercised
in tests. The traversal marker stays inside the temporary run.

## Verify locally

```text
node --test
```

Tests need permission to open temporary localhost ports. They never contact an
external host. `node scripts/demo-shop.mjs --write` regenerates the example report
from real responses. No build step, package installation or account is required.

Historical build/review rounds (9 rounds, 9 independent reviews) and the current
regression audit and merge verification are recorded in
[TEST-EVIDENCE.md](TEST-EVIDENCE.md).

## Coming next

Future owner-approved versions may add injection, other settings checks,
AI and desktop checks. They are not implemented in 0.6.0.

MIT licensed.
