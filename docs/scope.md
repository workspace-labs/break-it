# Version 0.1.0 scope

The approved workflow has four parts: Start safely, Attack the copy, Check the
seal, Report and fix. The build brief dated 2026-11-03 determines this release's
scope where the approved illustrative PDFs describe a broader example.

Only the independent reviewer of the code under test uses Break-it. The owner
must own and authorize the project; an existing local folder alone cannot prove
ownership. Reviewers check the intended change, choose relevant tries from the
two reference files and record omissions honestly. No general attack executor
is shipped. The CLI owns filesystem safety and report validation, not app startup.

This release covers bad-user inputs, request failures and a bounded wrong-login
check (at most 50 sequential requests), plus cross-user and normal-user/admin
access checks. It produces advice, never project fixes. No board status or owner
gate is changed. No live or third-party target is allowed.

The app under review must run entirely locally with synthetic data and external
integrations disabled. A filesystem copy is not an OS sandbox and does not block
an arbitrary app's outbound traffic or absolute-path writes. If isolation cannot
be established from its launch/configuration, stop before starting it. The CLI
itself makes no network calls. The teaching harness only calls literal loopback.

The CLI seals regular file bytes and names, and separately records symbolic link
text without following links. It recreates only relative links whose resolved
targets stay inside the project, retaining their text. Absolute, escaping and
unresolvable copied links are refused by name; special files remain refused.
--skip folders are sealed, including all their links, but never copied or checked
for link-copy eligibility. Windows link creation failure explains permissions or
Developer Mode and suggests --skip, with no target-copy fallback. Empty folders,
permissions and timestamps are not sealed. Do not concurrently mutate the source
or run folder: the tool detects observed changes, not hostile same-user races or
restored bytes. Hard-linked contents are copied into independent regular files.

Run state is temporary. After stop → seal → cleanup, run report with findings
that contain at least one completed logical try and no receipt field. Cleanup
writes the receipt under the guarded OS-temp break-it/receipts folder, outside
the deleted run, and prints only its path. Report reads it by run id, rechecks the
original seal, requires the run folder absent, and deletes the receipt after
successful validation. Failed reports retain the receipt for correction/retry.
Cleanup with the same run id can discard that pending receipt if the report is
abandoned after its run folder is gone.
An empty shared receipts folder may remain, but no per-run receipt remains after
a successful report. Receipts are local evidence, not signed attestations against
a malicious caller who can also edit the seal or scripts. Findings and final
reports are intentional review artifacts, stored outside the run. No services,
process registries or telemetry remain.

The CLI can reject UNC paths, roots, home folders and literal non-loopback URLs.
Portable Node cannot reliably distinguish a network-mounted local-looking drive;
the reviewer must confirm the source filesystem is local. Localhost must resolve
to loopback; prefer 127.0.0.1 when launching and testing.

The repository's scripts/ layout is intentional for this small skill. It takes
the place of a generic src/ directory. tests/ uses Node's built-in runner.
