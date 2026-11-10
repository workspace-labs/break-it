BREAK-IT REPORT shop-app · version 0.4.3
Seal: real project unchanged
Attacks: 12 tried   3 blocked   9 got through

CRITICAL  A secret is stored in configuration
  Tried  Scanned the copy before startup and after the requests
  Saw    A config assignment matched generic api_key  sho…only (31 chars)
  Where  config.mjs:1
  Advice Keep secret values out of source files and build output

CRITICAL  Other people's orders are open
  Tried  Logged in as user A, opened /orders/6 (user B's order)
  Saw    User B's order, item and example delivery address
  Where  server.mjs:93
  Advice Show an order only to the user who owns it

CRITICAL  Profile replies expose a password hash
  Tried  Opened /profile as synthetic user A
  Saw    The reply included a passwordHash field; its value is withheld
  Where  server.mjs:67
  Advice Return only the public profile fields; never return password hashes

CRITICAL  Catalog refresh stops answering under load
  Tried  After one successful request, sent 8 localhost catalog-refresh requests with concurrency 2
  Saw    5 requests failed without an HTTP status
  Where  server.mjs:40
  Advice Release completed catalog work and keep resource use bounded between requests

CRITICAL  Catalog refresh does not recover after the burst
  Tried  Compared the successful pre-burst catalog-refresh request with the final health probe
  Saw    The final request to the same target did not answer with an HTTP status
  Where  server.mjs:41
  Advice Release retained work so new requests still answer after the burst

SMALL  Empty input crashes one request
  Tried  Submitted empty text to /echo
  Saw    HTTP 500; the server remained alive
  Where  server.mjs:83
  Advice Reject empty text with a clear validation message before processing it

SMALL  No limit on login tries
  Tried  Sent 50 wrong logins for synthetic user B, sequentially on localhost
  Saw    All 50 answered without a retry limit
  Where  server.mjs:46
  Advice Apply a bounded retry limit and a clear retry-later response

SMALL  Error replies expose internal details
  Tried  Opened /catalog-error as synthetic user A
  Saw    HTTP 500 included a database error and an internal source path
  Where  server.mjs:71
  Advice Return a plain error message without database or internal path details

SMALL  Login never throttles a concurrent burst
  Tried  Sent 8 wrong logins for synthetic admin with concurrency 2 on localhost
  Saw    The burst answered consistently and its final probe still returned HTTP 401; no retry-later response
  Where  server.mjs:46
  Advice Bound login attempts and return a clear retry-later response to slow password guessing

Same cause: A09, D02 point to server.mjs:46; one fix may close both.

Copy deleted. Nothing left behind. Break-it changed no code.

ROUND 2 shop-app
Seal: real project unchanged
Attacks: 12 tried   12 blocked   0 got through
Critical holes: 0   ->   Ready for the owner's look

Copy deleted. Nothing left behind. Break-it changed no code.
