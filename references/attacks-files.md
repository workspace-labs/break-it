# Family E: Bad files (uploads)

## Contents

- [Generated files and bounds](#generated-files-and-bounds)
- [E01: Too big](#e01-too-big)
- [E02: Lies about its type](#e02-lies-about-its-type)
- [E03: Dangerous names](#e03-dangerous-names)
- [E04: Script inside a file](#e04-script-inside-a-file)
- [E05: Zip bomb](#e05-zip-bomb)
- [E06: Broken files](#e06-broken-files)
- [E07: Someone else's upload](#e07-someone-elses-upload)
- [E08: Reads outside the upload folder](#e08-reads-outside-the-upload-folder)
- [Safe control](#safe-control-a-normal-image-for-its-owner)

Try uploads only on the owner's own throwaway localhost copy, with invented
users and local sessions. Before any E-try, find where the copy saves uploads.
Resolve its actual configured folder, including symbolic links: it must be
inside the copy. An absolute path outside the copy, cloud bucket or shared
folder means **STOP the family** and record the affected E ids as skipped with
the reason. Never let an upload try write outside the copy. If storage or
unpacking cannot be established as local to the copy, skip rather than guess.

Break-it makes every test file itself from the fixed list below. Never download
a payload, build one by hand, or point upload at a file of your own. Use `make`,
then `upload`; use `send GET` for subsequent reads. All generated files stay in
`<runPath(id)>/files/` until the existing cleanup removes the whole run.

## Generated files and bounds

The `--mb` unit is MiB (1,048,576 bytes); the CLI calls it MB for brevity.
These are fixed kinds, not paths or user-supplied content:

- `normal-png`: `normal.png`, a tiny valid PNG; default type `image/png`.
- `big`: `big.bin`, streamed zeros, default 20 MiB, optional `--mb N` from 1
  through 50 MiB; default type `application/octet-stream`.
- `fake-image`: `photo.jpg`, harmless HTML text claiming to be an image;
  default type `image/jpeg`.
- `html-script`: `marker.html`, harmless HTML whose only script sets
  `document.title = "break-it"`; default type `text/html`.
- `svg-script`: `marker.svg`, an SVG with the same title-only script;
  default type `image/svg+xml`.
- `zip-bomb`: `zeros.zip`, a valid ZIP with one zeros entry, exactly 100 MiB
  unpacked and under 1 MiB on disk; default type `application/zip`. It is never
  nested and cannot be made larger.
- `empty`: `empty.png`, zero bytes; default type `image/png`.
- `truncated-png`: `truncated.png`, the normal PNG cut in half; default type
  `image/png`.

```text
node scripts/break-it.mjs make <run-id> normal-png
node scripts/break-it.mjs upload <run-id> POST http://localhost:4000/upload --file normal.png --token LOCAL_TEST_SESSION
```

Each upload is one multipart request with one file part, streamed from disk.
Only POST and PUT are accepted. `--file` is a bare made filename inside that
run's `files/` folder: no slash, backslash or `..`. Arbitrary files, including
symbolic-link substitutes, are refused. Optional `--field` defaults to `file`;
`--type` changes the claimed content type for E02. `--token` follows `send`'s
bearer rules. The body including multipart framing is capped at 51 MiB.
The localhost, literal-loopback, no-redirect and no-retry walls remain. The
upload allows the server to keep the connection open for its reply, then closes
its single-use socket after that reply; connections are never pooled or reused.
If a server forcibly resets before a response arrives, record an inconclusive
request failure, never infer that it accepted or refused the file.
The
deadline is 5 seconds, extended to 30 seconds only for `big`, stated in its
output. The reply body stays capped at 2 KiB and is masked before CLI display.
A timeout or cut reply alone does not establish a hole.

`--name` accepts only these presets, used in the part header and never as a
local input path:

- `traversal`: `../break-it-escape-<runId>.txt`, exactly one level up.
- `null-byte`: `photo.png\u0000.html`, with an actual null byte on the wire.
- `long`: 300 `a` characters followed by `.png`.
- `arabic`: `صورة.png`.
- `emoji`: `📷.png`.
- `reserved`: `CON.png`.

Without `--name`, the sent name is the made filename. No free-text sent name is
accepted. Send one preset at a time. After the tries, list any
`break-it-escape-*` files inside the copy or its run folder as E03 evidence,
using local inspection without reading unrelated folders. Stop on an observed
crash or outage; never escalate or repeat a damaging try.

## E01: Too big

- **Send:** Make `big`, then upload it once to the copy's upload route. Start
  with the default 20 MiB; never exceed the 50 MiB generation cap. Observe the
  app's read path and health, not only the status code.
- **BLOCKED:** The app gives a clear 4xx size refusal before reading all the
  bytes; inspection confirms a bounded upload read.
- **HOLE:** The oversized file is accepted, or the app crashes or stops
  answering. A refusal after reading the whole file still fails the early-read
  boundary; describe that separately from a crash.
- **Severity:** CRITICAL for an observed crash or outage; otherwise SMALL.

## E02: Lies about its type

- **Send:** Make `fake-image` and upload `photo.jpg` with `--type image/jpeg`.
  Inspect how the copy validates, stores and later serves it.
- **BLOCKED:** The app checks the actual bytes and refuses an invalid image,
  or otherwise ensures the content can never be served as active HTML.
- **HOLE:** The app keeps it as an image and later serves it as HTML, or checks
  only its filename or claimed type. A 2xx alone does not prove the outcome.
- **Severity:** SMALL, or CRITICAL when the behavior leads to E04.

## E03: Dangerous names

- **Send:** Upload `normal-png` once for each `--name` preset: traversal,
  null-byte, long, arabic, emoji and reserved. Confirm storage is inside the
  copy first; the traversal marker is only one level above the upload folder.
- **BLOCKED:** Names are rejected or safely handled; every saved file remains
  inside the app's upload folder, and later pages and the app remain healthy.
- **HOLE:** A file appears outside that upload folder, the app crashes, or the
  name breaks a later page. List each found traversal marker and its relative
  location in the copy or run folder as evidence.
- **Severity:** Traversal or crash is CRITICAL; other name-handling failures
  are SMALL. A valid Arabic or emoji filename working normally is not a hole.

## E04: Script inside a file

- **Send:** Make and upload `html-script` and `svg-script`, one at a time.
  Read the local address returned by the copy with `send GET`; request the
  bounded response headers as well as its body:

  ```text
  node scripts/break-it.mjs send GET http://localhost:4000/uploads/marker.html --headers --token LOCAL_TEST_SESSION
  ```

  Check Content-Type, Content-Disposition and Content-Security-Policy. The optional
  header block is capped at 2 KiB. A `(headers cut; incomplete evidence)` marker
  makes the header evidence inconclusive; do not infer missing protections. Never
  follow an external returned address or redirect.
- **BLOCKED:** The content is refused, served as an attachment, or isolated by
  a sandboxing CSP that actually prevents scripts from acting in the app's
  origin. A CSP with `sandbox allow-scripts allow-same-origin` is not sufficient.
- **HOLE:** It is served inline as `text/html` or `image/svg+xml` from the app's
  own origin without `Content-Disposition: attachment` or an effective
  sandboxing CSP. The only embedded script is the harmless title marker.
- **Severity:** CRITICAL.

## E05: Zip bomb

- **Send:** Only if the app unpacks archives, make and upload `zip-bomb` once.
  First establish its extraction path stays inside the copy and watch that
  copy's disk use and memory. Otherwise skip E05 with a reason.
- **BLOCKED:** A total unpacked-byte limit stops extraction before the allowed
  budget is exceeded, and the app stays healthy. A compressed-size check alone
  does not establish this boundary.
- **HOLE:** The app unpacks the archive without an unpacked-size limit.
- **Severity:** CRITICAL. Never increase the fixed 100 MiB entry or add nesting.

## E06: Broken files

- **Send:** Make `empty` and `truncated-png`, then upload each once as an image.
  Observe the response and whether the app still answers.
- **BLOCKED:** The app cleanly refuses malformed images with a clear 4xx and
  keeps working, without internal details in its reply.
- **HOLE:** A crash, hang, or 5xx reply with internal detail. Establish the
  cause of a timeout before reporting it as a hang.
- **Severity:** Crash or hang is CRITICAL; a 5xx is SMALL.

## E07: Someone else's upload

- **Send:** User A uploads `normal-png`. Establish that the resulting file is
  private to A and that A can read it with `send GET`. Then request the same
  known local address as invented user B with `--token`, and without a token.
  Do not enumerate filenames.
- **BLOCKED:** B and the unauthenticated request get no A-private file bytes;
  A's allowed read still works.
- **HOLE:** B or an unauthenticated reader can read A's private file. An
  intentionally public upload is inapplicable, with its policy recorded.
- **Severity:** CRITICAL.

## E08: Reads outside the upload folder

- **Send:** Apply the same upload-storage-inside-the-copy check first; **STOP
  the family** if the actual upload folder is outside the copy or cannot be
  established, and record the affected ids as skipped. Choose a harmless file
  you have already seen exactly one level above that folder, still inside the copy,
  such as the app's own source or package file. With the existing `send GET`,
  ask the copy's download address for `..%2F<file>` and then `%2E%2E%2F<file>`.
  For example, only after confirming `server.mjs` is that known file inside the
  copy:

  ```text
  node scripts/break-it.mjs send GET http://localhost:4000/uploads/..%2Fserver.mjs --token LOCAL_TEST_SESSION
  node scripts/break-it.mjs send GET http://localhost:4000/uploads/%2E%2E%2Fserver.mjs --token LOCAL_TEST_SESSION
  ```

  Never aim outside the copy or ask for system files. Do not add another parent
  step or enumerate unknown names. `send` already masks detected secrets in its
  bounded reply; a cut reply alone is inconclusive.
- **BLOCKED:** A 4xx/404 response and no file content comes back.
- **HOLE:** The known file's content comes back from outside the upload folder.
  The finding quotes only the status and the file name, never the content.
- **Severity:** CRITICAL.

## Safe control: A normal image for its owner

- **Send:** Make and upload `normal-png` as A, then `send GET` its returned
  local address as A. Compare the expected file bytes and valid image response.
- **BLOCKED:** A can upload and read the valid image according to the app's
  documented policy, and the app remains healthy.
- **HOLE:** None for normal success. Never flag the safe control just because
  an upload or its owner's read succeeded.
- **Severity:** None for a passing control. Count it as blocked against the
  attempted failure, not as a finding.

Count each completed logical try once, including controls. Use E01–E08 ids and
the existing Tried, Saw, Where and Advice fields; `Where` is a real relative
`file:line` in the copy. Use unique descriptive suffixes when several distinct
name or file cases become findings. Skipped or inconclusive tries do not add to
counts. Stop the app, seal, cleanup and report as usual; cleanup deletes made
files together with the run, and a successful report consumes its receipt.
