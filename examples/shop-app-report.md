BREAK-IT REPORT shop-app · version 0.7.0
Seal: real project unchanged
Attacks: 34 tried   11 blocked   23 got through

CRITICAL  A secret is stored in configuration
  Tried  Scanned the copy before startup and after the requests
  Saw    A config assignment matched generic api_key  sho…only (31 chars)
  Where  config.mjs:1
  Advice Keep secret values out of source files and build output

CRITICAL  Other people's orders are open
  Tried  Logged in as user A, opened /orders/6 (user B's order)
  Saw    User B's order, item and example delivery address
  Where  server.mjs:253
  Advice Show an order only to the user who owns it

CRITICAL  Profile replies expose a password hash
  Tried  Opened /profile as synthetic user A
  Saw    The reply included a passwordHash field; its value is withheld
  Where  server.mjs:218
  Advice Return only the public profile fields; never return password hashes

CRITICAL  Catalog refresh stops answering under load
  Tried  After one successful request, sent 8 localhost catalog-refresh requests with concurrency 2
  Saw    5 requests failed without an HTTP status
  Where  server.mjs:123
  Advice Release completed catalog work and keep resource use bounded between requests

CRITICAL  Catalog refresh does not recover after the burst
  Tried  Compared the successful pre-burst catalog-refresh request with the final health probe
  Saw    The final request to the same target did not answer with an HTTP status
  Where  server.mjs:124
  Advice Release retained work so new requests still answer after the burst

CRITICAL  An upload can escape its upload folder
  Tried  Uploaded a generated PNG using the one-level traversal name preset
  Saw    Found copy/break-it-escape-1ff48a0f-fd0a-486d-8673-836d8376fdea.txt inside the run, outside the app upload folder
  Where  server.mjs:181
  Advice Reject path segments and keep every saved file inside the upload folder

CRITICAL  Uploaded script markers are served inline
  Tried  Uploaded generated HTML and SVG title markers, then fetched the returned file addresses
  Saw    Served inline as text/html and image/svg+xml without attachment or sandboxing CSP
  Where  server.mjs:205
  Advice Serve untrusted active files as attachments or isolate them with a sandboxing policy

CRITICAL  Other people's private uploads are readable
  Tried  Uploaded a generated PNG as user A; fetched its address as user B and without a login
  Saw    User B received HTTP 200; no login received HTTP 401
  Where  server.mjs:199
  Advice Check the file owner before returning any private upload

CRITICAL  Reads outside the upload folder
  Tried  Requested server.mjs one level above uploads inside the copy using ..%2F and %2E%2E%2F
  Saw    server.mjs: HTTP 200 and HTTP 200
  Where  server.mjs:202
  Advice Refuse download names whose resolved paths leave the upload folder before checking file ownership

CRITICAL  Logout leaves the old login working
  Tried  Logged in with the jar, called POST /logout with hold, then reused its old cookie on the own-order route
  Saw    Logout cleared the cookie, but the held old session still answered HTTP 200
  Where  server.mjs:16
  Advice Invalidate the server session when logging out

CRITICAL  Login values have a predictable shape
  Tried  Logged in ten times sequentially as synthetic user A; A09 uses separate user B and budgets are tracked per user
  Saw    samples: 10; unique: 10; length min/max: 16/16; characters: digits; rough strength ≈ 53.2 bits (upper bound); longest shared start 13 chars; counts up
  Where  server.mjs:17
  Advice Issue unpredictable session values; no pattern found in a small sample would not prove randomness

SMALL  Empty input crashes one request
  Tried  Submitted empty text to /echo
  Saw    HTTP 500; the server remained alive
  Where  server.mjs:243
  Advice Reject empty text with a clear validation message before processing it

SMALL  No limit on login tries
  Tried  Sent 50 wrong logins for synthetic user B, sequentially on localhost
  Saw    All 50 answered without a retry limit
  Where  server.mjs:129
  Advice Apply a bounded retry limit and a clear retry-later response

SMALL  Error replies expose internal details
  Tried  Opened /catalog-error as synthetic user A
  Saw    HTTP 500 included a database error and an internal source path
  Where  server.mjs:222
  Advice Return a plain error message without database or internal path details

SMALL  Login never throttles a concurrent burst
  Tried  Sent 8 wrong logins for synthetic admin with concurrency 2 on localhost
  Saw    The burst answered consistently and its final probe still returned HTTP 401; no retry-later response
  Where  server.mjs:129
  Advice Bound login attempts and return a clear retry-later response to slow password guessing

SMALL  Oversized uploads are accepted
  Tried  Uploaded a generated 20 MiB file to the disposable copy
  Saw    HTTP 201 accepted every byte; the copy stayed healthy
  Where  server.mjs:179
  Advice Reject oversized uploads with a clear 4xx before reading the whole body

SMALL  A cut upload leaves an incomplete file available
  Tried  Uploaded a complete generated 100 KiB PNG, then sent half its multipart body and closed
  Saw    The copy still answered; 51154 of 102400 file bytes remained in uploads and GET served HTTP 200
  Where  server.mjs:180
  Advice Keep the prior file intact and publish an upload only after the complete request has arrived

SMALL  Slow headers have no app time limit
  Tried  Dripped request headers one byte every 500 ms for one second while probing catalog
  Saw    The during and after probes answered HTTP 200; the connection stayed open at our cap and source confirms headersTimeout and requestTimeout are 0
  Where  server.mjs:108
  Advice Set short bounded header and request time limits; F02 and F04 share this one configuration cause

SMALL  An incomplete body has no app time limit
  Tried  Sent ten bytes of a longer JSON body and went silent for one second while probing catalog
  Saw    The during and after probes answered HTTP 200; the connection stayed open at our cap and source confirms headersTimeout and requestTimeout are 0
  Where  server.mjs:108
  Advice Set short bounded header and request time limits; F02 and F04 share this one configuration cause

SMALL  Login sessions have no enforced lifetime
  Tried  Read the copy session lifetime code and the login cookie attributes without waiting
  Saw    Session expiration is disabled; stored sessions have no expiry and the cookie has no Max-Age or Expires
  Where  server.mjs:18
  Advice Enforce a bounded server lifetime and give the session cookie a matching lifetime

SMALL  Changing the password leaves another login working
  Tried  Logged in twice, changed the own password with one session, then tested the other session
  Saw    The other session still answered HTTP 200 after the password change
  Where  server.mjs:19
  Advice End the user other sessions when the password changes

SMALL  The login cookie lacks protective flags
  Tried  Read only the session cookie attribute names from the login reply
  Saw    The session cookie lacks HttpOnly and SameSite; Secure needs production configuration review, not a localhost HTTP verdict
  Where  server.mjs:20
  Advice Add HttpOnly and SameSite, and judge Secure from the production HTTPS settings

SMALL  Login errors reveal which users exist
  Tried  Compared one wrong password for synthetic user A with one made-up user name
  Saw    Both replies were HTTP 401, but one said Wrong password and the other No such user
  Where  server.mjs:21
  Advice Return the same status and plain message for both failed logins

Same cause: A09, D02 point to server.mjs:129; one fix may close both.
Same cause: F02, F04 point to server.mjs:108; one fix may close both.

Skipped (not counted)
  E02                Claimed-type case covered by separate upload tests
  E05                Shop stores archives without unpacking them; archive bytes covered by separate tests
  E06                Empty and truncated PNG cases covered by separate upload tests
  G02-jwt-none       The shop does not issue JWTs; unsigned and bad-signature JWT behavior is covered by local fixture tests
  G02-jwt-bad-sig    The shop does not issue JWTs; unsigned and bad-signature JWT behavior is covered by local fixture tests

Copy deleted. Nothing left behind. Break-it changed no code.

ROUND 2 shop-app
Seal: real project unchanged
Attacks: 34 tried   34 blocked   0 got through
Critical holes: 0   ->   Ready for the owner's look

Skipped (not counted)
  E02                Claimed-type case covered by separate upload tests
  E05                Shop stores archives without unpacking them; archive bytes covered by separate tests
  E06                Empty and truncated PNG cases covered by separate upload tests
  G02-jwt-none       The shop does not issue JWTs; unsigned and bad-signature JWT behavior is covered by local fixture tests
  G02-jwt-bad-sig    The shop does not issue JWTs; unsigned and bad-signature JWT behavior is covered by local fixture tests

Copy deleted. Nothing left behind. Break-it changed no code.
