# Family A: Bad user & crashes

Use only on the owner's throwaway copy, with disposable local data. Read the
change's intended input rules first. A correct success response for valid Arabic,
emoji, or punctuation is safe; do not flag valid input merely because it differs
from English letters. Silent acceptance is a hole only when it violates the
documented field rules or causes an observed incorrect result.

One logical try gets one outcome. Wait for it before the next. Use a 5-second
request deadline, inspect app health after failures, and stop if the app hangs or
exits. A timeout without a cause established is an incomplete try, not proof of a
hole. Do not repeat a damaging try. Recreate disposable state between independent
cases. Keep every request on the copy's localhost port; never follow redirects.

Severity: **CRITICAL** for a reproducible whole-app exit, persistent outage, or
serious unauthorized data change; **SMALL** for a single-request failure, validation
defect, stack trace, or absent login limit without demonstrated wider impact.

## A01: Empty input

- **Send:** One required text field as `""`, then check the app is still healthy.
- **BLOCKED:** A clear validation response with no state change, or a documented
  valid empty value handled normally.
- **HOLE:** Request fails unexpectedly, app stops, a stack trace appears, or an
  invalid empty field is accepted and changes state.
- **Severity:** SMALL for the example's request-only 500; CRITICAL if the whole app
  exits or becomes persistently unavailable. State which behavior you observed.

## A02: Huge input

- **Send:** One large text field in one request, or one byte over a smaller
  documented limit. Keep the entire UTF-8 request body within `send`'s 64 KiB
  cap, including JSON keys, quotes and braces; reduce the field to fit.
- **BLOCKED:** Bounded validation/size rejection, or normal handling within the
  documented supported size; app stays responsive.
- **HOLE:** Reproducible crash, stack trace, hang, or an over-limit field saved.
- **Severity:** SMALL for validation/request failures; CRITICAL for a persistent
  outage or app exit attributable to this single request.

## A03: Wrong type

- **Send:** A number, `null`, array, or object where the contract requires text;
  try one representative wrong type at a time, at most four requests.
- **BLOCKED:** Clear rejection or documented safe normalization.
- **HOLE:** Type error/stack trace, app exit, or invalid state saved without warning.
- **Severity:** SMALL unless the observed impact meets the CRITICAL rule above.

## A04: Arabic

- **Send:** `مرحبا بالعالم` in a supported text field.
- **BLOCKED:** Text is preserved and handled normally, or clearly rejected by a
  documented field restriction.
- **HOLE:** Unexpected failure, corrupted saved text, or a demonstrated rule bypass.
- **Severity:** SMALL unless the observed impact meets the CRITICAL rule above.

## A05: Emoji

- **Send:** `Hello 👋🏽 🛍️` in a supported text field.
- **BLOCKED:** Normal preservation/handling or a documented validation response.
- **HOLE:** Unexpected failure, corrupted saved text, or a demonstrated rule bypass.
- **Severity:** SMALL unless the observed impact meets the CRITICAL rule above.

## A06: Special characters

- **Send:** Plain punctuation such as `O'Neil & Co. <test> "hello"` in a text field.
  Treat it as text; use no executable payload.
- **BLOCKED:** Safe text handling or a clear response matching the field rules.
- **HOLE:** Unexpected crash, stack trace, corrupted data, or invalid state saved.
- **Severity:** SMALL unless the observed impact meets the CRITICAL rule above.

## A07: Double submit

- **Send:** The same disposable create/update submission twice, with at most two
  overlapping requests. Use a harmless local operation, never real payments.
- **BLOCKED:** One result when the operation promises one, or two intentional
  results when that is its documented behavior.
- **HOLE:** Unexpected duplicate action/data or app failure.
- **Severity:** SMALL for a harmless duplicate; CRITICAL only for demonstrated
  serious unauthorized data change or a persistent outage.

## A08: Missing fields

- **Send:** One request omitting one required field; use disposable test state.
- **BLOCKED:** Clear validation response, no invalid state written, app healthy.
- **HOLE:** Unexpected failure/stack trace or invalid state saved silently.
- **Severity:** SMALL unless the observed impact meets the CRITICAL rule above.

## A09: Small burst of wrong logins

- **Send:** Up to **50** wrong logins, sequentially, against one disposable local
  account. Stop at the first slowdown, lock, or limit response. Never use a real
  password list or guess another person's password.
- **BLOCKED:** The app applies its documented bounded try limit or slowdown.
- **HOLE:** All 50 wrong tries receive ordinary rejection without any limit or
  slowdown. Report only the tested bound; do not claim unlimited tries were proved.
- **Severity:** SMALL. Report an app exit/persistent outage separately if observed.
