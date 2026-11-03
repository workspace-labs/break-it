# Family C: Leaks

Use only on the owner's throwaway copy, with invented local accounts and data.
Never test whether a key works against its provider. A working-looking secret is
enough to report; the pattern scanner cannot prove validity. Read
[the built-in patterns and limits](leak-patterns.md) before interpreting a result.

A whole secret value is never printed, saved, or put in findings. Mask with the
first 3 characters + `…` + last 4, then ` (N chars)`. For 8 characters or fewer,
use `•••• (N chars)`. Never include whole source lines, response values or raw
history as evidence. Name the field, masked value, location and observed effect.

## C01: Secrets in files

- **Send:** Before app startup, run `node scripts/break-it.mjs scan <run-id>`.
  It checks code, configuration, `.env*`, build output and bundled assets inside
  the copy. Inspect the masked hits; account for skipped files and size notes.
- **BLOCKED:** No working-looking secret is found in the inspected files;
  documented placeholders remain unflagged. This is bounded pattern coverage.
- **HOLE:** A working-looking key, token, password or private key is embedded in
  a file that should not keep it. Evidence contains only its masked form.
- **Severity:** CRITICAL. Use the relative file and line printed by `scan`.

## C02: Secrets in git history

- **Send:** If git is on PATH and the copy has a `.git` directory, pipe the copy's
  history straight into `mask`, from the skill folder:

  ```text
  git -C "<copy>" log -p --all --no-color | node scripts/break-it.mjs mask
  ```

  Replace `<copy>` with this run's copy folder, never the real source folder.
  Do not display, redirect, tee, save, or read the unmasked history. If git is
  unavailable, `.git` is absent (for example after `copy --skip`), or history
  cannot be read safely, record C02 as skipped with the reason. A cap note means
  incomplete coverage, not a clean history. Check both command exit statuses;
  an upstream git failure must never count as blocked.
- **BLOCKED:** The inspected history contains no matching secret. A removed
  secret still present in an old commit does not meet this outcome.
- **HOLE:** A secret remains in any inspected commit, even if current files are
  clean. `mask` prints only hits with their nearest commit and file; never raw
  context. Use `mask`'s historical line from the patch hunk counters; added lines
  use the new side and deleted lines use the old side. Never invent a line number.
- **Severity:** CRITICAL. Use `Where` as
  `<file>:<line> -> commit <7-char hash>`, with the observed historical line,
  rather than inventing a current-file location.

## C03: Replies that say too much

- **Send:** Through `send`, request one known local profile or record as an
  authenticated disposable user. Compare fields with the intended public contract
  and the established ownership of synthetic records; use no id enumeration.
- **BLOCKED:** Only permitted data is returned, without password hashes or secrets.
- **HOLE:** A reply includes another user's private data, a password hash, a
  secret, or unnecessary internal fields from the caller's own record. Describe
  field names and relationships; never paste the returned private values.
- **Severity:** CRITICAL for another user's private data or any password
  hash/secret; SMALL for extra internal ids or debug flags on the caller's record.
  Locate the response construction in the copy.

## C04: Errors that say too much

- **Send:** Through `send`, submit one bounded invalid request to an applicable
  route, then check that the copy remains healthy. Use the existing A-family
  limits; no executable payload or external target is needed.
- **BLOCKED:** A clear, useful error omits implementation details and secrets.
- **HOLE:** The reply reveals a stack trace, internal file path, SQL, or an
  internal error message. Record the kind of detail without copying private values.
- **Severity:** SMALL for implementation details. Any returned secret belongs
  under C03's CRITICAL rule. Locate the error response in the copy.

## C05: Logs that keep private data

- **Send:** After the tries, run `node scripts/break-it.mjs scan <run-id>` again.
  Inspect masked hits in logs the app wrote inside the copy; compare with the
  before-startup scan and the invented credentials sent during this run. For
  other personal data, use a secret-safe view and only synthetic test records.
- **BLOCKED:** The inspected logs omit passwords/tokens and avoid unnecessary
  personal data. No log output, inaccessible logs, or logs outside the copy are
  not proof; record missing coverage as skipped or inconclusive with a reason.
- **HOLE:** A password/token used in the run is stored in a copy-local log, or
  the log retains other unnecessary personal data. Never collect a whole value.
- **Severity:** CRITICAL for passwords/tokens; SMALL for other personal data.
  Use the actual relative log file and line, with masked evidence.

## Safe control

A value documented as a placeholder, such as `.env.example` with
`KEY=your-key-here`, must not become a finding. Run the scan and confirm that
control remains unflagged. The filename alone grants no exemption: a real-looking
secret in `.env.example` is still a C01 finding. Do not exempt a long value merely
because the word EXAMPLE appears inside it.

The scanner skips `.git`, binaries and files larger than 1 MiB, and never follows
symbolic links. Disclose incomplete coverage; use C02 for history. Split,
encoded or custom secret formats can escape this small pattern list, so a clean
scan never proves the absence of every possible leak. Keep each completed
logical try's outcome and all counts honest. Break-it supplies advice, never fixes.
