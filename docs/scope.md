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

The CLI refuses source symlinks and special files rather than preserving aliases
to real data. It seals all regular file bytes and names, even when --skip omits
some directories from the copy. Empty directories, permissions and timestamps
are not part of the seal. Do not concurrently mutate the source or run folder:
the tool detects observed changes, not hostile same-user races or restored bytes.
Hard-linked source files are read as bytes and copied into independent files.

Run state is temporary. After stop → seal → cleanup, put cleanup's receipt into
the intentional findings artifact and run report. Report rechecks the original
seal and requires the run folder absent. Receipts are local evidence, not signed
attestations against a malicious caller who can also edit the seal or scripts.
No hidden receipts, services, process registries or telemetry remain. Findings
and final reports are intentional review artifacts, stored outside the run.

The CLI can reject UNC paths, roots, home folders and literal non-loopback URLs.
Portable Node cannot reliably distinguish a network-mounted local-looking drive;
the reviewer must confirm the source filesystem is local. Localhost must resolve
to loopback; prefer 127.0.0.1 when launching and testing.

The repository's scripts/ layout is intentional for this small skill. It takes
the place of a generic src/ directory. tests/ uses Node's built-in runner.
