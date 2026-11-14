# Family G: Login and sessions

## Contents

- [Safe control first](#safe-control-first)
- [G01: Logout does not log out](#g01-logout-does-not-log-out)
- [G02: Fake or changed login value](#g02-fake-or-changed-login-value)
- [G03: Guessable login values](#g03-guessable-login-values)
- [G04: A login that never ends](#g04-a-login-that-never-ends)
- [G05: New password, old login still works](#g05-new-password-old-login-still-works)
- [G06: Unsafe login cookie or login in the address](#g06-unsafe-login-cookie-or-login-in-the-address)
- [G07: Login error gives too much away](#g07-login-error-gives-too-much-away)

## Safe control first

Use only the owner's own throwaway COPY on its localhost port, with made-up
local users. A login value (bearer key or session cookie) is never printed or
saved in findings: show only its name, length, flags or pattern, never any of its
characters. Never send it anywhere except that copy's localhost port.

- **Send:** A correct login, then a request to a route that requires that login.
  Use `send --jar <run-id>` to retain cookies inside the guarded run, without
  viewing the jar. Repeat a correct login/session control after the family.
- **BLOCKED:** Both controls answer normally as the disposable user.
- **HOLE:** None for a passing control. Stop if login or the protected route
  fails; record the incomplete observation instead of inventing a finding.
- **Severity:** None; count the passing before/after control as one blocked try.

Run G last among the per-request families: logout and password changes alter
state. Keep a per-user login budget: count A09 and G03 logins together against
the same disposable user, and stop at any lockout. Never bypass a lockout.
Do not paste a bearer into a tool transcript. Prefer the cookie jar; a
programmatic bearer flow must keep response values in memory and use
`sendRequest` only. The CLI deliberately masks JSON login fields.

```text
node scripts/break-it.mjs send POST http://localhost:4000/login --jar <run-id> --json '{"user":"A","password":"invented"}' --headers
node scripts/break-it.mjs send GET http://localhost:4000/account --jar <run-id>
```

`--headers` masks every Set-Cookie value, even a short harmless-looking value,
and shows the flags as sent. The header block has a 2 KiB cap; `(headers cut;
incomplete evidence)` means unseen flags are unknown. Never read raw cookie
files to fill that gap. `--jar` sends cookies only to the exact localhost
host:port that issued them, honors path/expiry, and never follows Domain to
another host. At most 20 cookies, each at most 4 KiB; cleanup deletes the jar.
There is no free-text cookie option.

## G01: Logout does not log out

- **Send:** Log in, use the app's logout route, then reuse the SAME old value
  on a protected route. Preserve that old value in memory (or a separate
  guarded run jar before logout); a logout response may clear the active jar.
  Merely sending no cookie after logout does not test revocation.
- **BLOCKED:** The old value is refused as unauthenticated.
- **HOLE:** The old value still works as the logged-in user.
- **Severity:** CRITICAL. Skip with a reason if there is no logout route.

## G02: Fake or changed login value

- **Send:** Start with a valid disposable login. Use `--forge made-up` and
  `--forge one-char` on its bearer or jar cookies. For JWTs only, also use
  `jwt-none` and `jwt-bad-sig`. Each forge affects one request only and is
  neither saved nor printed. A JWT has three base64url parts; its payload is
  never edited. JWT kinds refuse non-JWT values with a plain message.

  ```text
  node scripts/break-it.mjs send GET http://localhost:4000/account --jar <run-id> --forge one-char
  ```

- **BLOCKED:** Every forged value is refused as unauthenticated. Establish
  logged-in identity; an ordinary public 200 response proves nothing.
- **HOLE:** Any forged value is accepted as a logged-in user.
- **Severity:** CRITICAL. Preserve the valid original for an after control.

## G03: Guessable login values

- **Send:** Use `sessions` with the same disposable user every time. Default
  10 logins, strict integer count 1–20, sequential through `sendRequest` only.
  Choose exactly one JSON field or cookie name from the copy's code.

  ```text
  node scripts/break-it.mjs sessions <run-id> POST http://localhost:4000/login --json '{"user":"A","password":"invented"}' --field token --count 10
  node scripts/break-it.mjs sessions <run-id> POST http://localhost:4000/login --json '{"user":"A","password":"invented"}' --cookie-name shop_session
  ```

  Values stay in memory; the command prints only samples, unique count, length
  min/max, character family, rough strength in bits (an upper bound), longest
  shared start, and detected patterns. A failed login stops with its status
  and no analysis. Count these with A09's logins for that user; stop at lockout.
- **BLOCKED:** No listed pattern and no sub-64-bit upper bound observed.
  `no pattern found in N samples` is not proof of randomness or safety.
- **HOLE:** `repeats`, `counts up`, `contains the time` (Unix seconds or
  milliseconds within ±1 day of now), or `contains the user name`.
  A rough strength below 64 bits is a separate SMALL observation; do not count
  the same logical try twice when a CRITICAL pattern already explains it.
- **Severity:** CRITICAL for those patterns; SMALL for strength below 64 bits.

## G04: A login that never ends

- **Send:** Read the COPY's session code and configuration for a lifetime;
  inspect login cookie Max-Age/Expires with `send --headers`.
  Never wait for real time to pass. An unknown lifetime is inconclusive.
- **BLOCKED:** A finite lifetime is enforced by the app. A cookie expiry alone
  does not establish server-side expiry for a stolen value.
- **HOLE:** No lifetime exists anywhere in code and none is configured.
- **Severity:** SMALL. Record code/config evidence; unknown is not a hole.

## G05: New password, old login still works

- **Send:** Only where the copy has a change-password route: log in twice,
  keeping two values in memory or separate run jars. Change the disposable
  user's own password with one session, supplying its current password if
  required, then test the OTHER old value on a protected route. Use only an
  invented replacement password and track it for the final correct login.
- **BLOCKED:** The other old session is refused.
- **HOLE:** The other old session still works after the password change.
- **Severity:** SMALL. Skip with a reason when there is no such route.

## G06: Unsafe login cookie or login in the address

- **Send:** Inspect the login reply with `--headers`. Read the copy's code or
  make one bounded `send` to establish whether it issues or accepts login
  values in the web address query string. Never print that address/value.
- **BLOCKED:** The session cookie has HttpOnly and SameSite; login values are
  not issued or accepted in the query string. Judge Secure from the copy's
  PRODUCTION settings in code, never from localhost HTTP. State that boundary.
- **HOLE:** Missing HttpOnly or SameSite on the session cookie; or established
  issue/acceptance of a login value in the query string.
- **Severity:** SMALL. A cut header block or unknown production configuration
  is inconclusive for that part; cookie checks are skipped if no cookie exists.

## G07: Login error gives too much away

- **Send:** One wrong password for a real made-up user, then one made-up
  nonexistent user name. Keep within that user's combined budget.
  Compare status and message; timing differences are out of scope.
- **BLOCKED:** The status and message do not distinguish which users exist.
- **HOLE:** The status or message differs and reveals which user exists.
- **Severity:** SMALL. Stop on lockout and keep incomplete results honest.

Stop only the copy's process you started, then seal, cleanup and report as
usual. Keep G01–G07 findings outside the run with actual relative file:line,
Tried/Saw/Where/Advice and shape-only evidence. Never copy values or encode
them to bypass the report guard.
