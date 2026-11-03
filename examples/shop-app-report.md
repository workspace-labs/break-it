BREAK-IT REPORT shop-app · version 0.3.0
Seal: real project unchanged
Attacks: 8 tried   2 blocked   6 got through

CRITICAL  A secret is stored in configuration
  Tried  Scanned the copy before startup and after the requests
  Saw    A config assignment matched generic api_key  sho…only (31 chars)
  Where  config.mjs:1
  Advice Keep secret values out of source files and build output

CRITICAL  Other people's orders are open
  Tried  Logged in as user A, opened /orders/6 (user B's order)
  Saw    User B's order, item and example delivery address
  Where  server.mjs:80
  Advice Show an order only to the user who owns it

CRITICAL  Profile replies expose a password hash
  Tried  Opened /profile as synthetic user A
  Saw    The reply included a passwordHash field; its value is withheld
  Where  server.mjs:54
  Advice Return only the public profile fields; never return password hashes

SMALL  Empty input crashes one request
  Tried  Submitted empty text to /echo
  Saw    HTTP 500; the server remained alive
  Where  server.mjs:70
  Advice Reject empty text with a clear validation message before processing it

SMALL  No limit on login tries
  Tried  Sent 50 wrong logins for synthetic user B, sequentially on localhost
  Saw    All 50 answered without a retry limit
  Where  server.mjs:33
  Advice Apply a bounded retry limit and a clear retry-later response

SMALL  Error replies expose internal details
  Tried  Opened /catalog-error as synthetic user A
  Saw    HTTP 500 included a database error and an internal source path
  Where  server.mjs:58
  Advice Return a plain error message without database or internal path details

Copy deleted. Nothing left behind. Break-it changed no code.

ROUND 2 shop-app
Seal: real project unchanged
Attacks: 8 tried   8 blocked   0 got through
Critical holes: 0   ->   Ready for the owner's look

Copy deleted. Nothing left behind. Break-it changed no code.
