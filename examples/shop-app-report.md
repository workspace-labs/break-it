BREAK-IT REPORT shop-app · version 0.2.0
Seal: real project unchanged
Attacks: 4 tried   1 blocked   3 got through

CRITICAL  Other people's orders are open
  Tried  Logged in as user A, opened /orders/6 (user B's order)
  Saw    User B's order, item and example delivery address
  Where  server.mjs:65
  Advice Show an order only to the user who owns it

SMALL  Empty input crashes one request
  Tried  Submitted empty text to /echo
  Saw    HTTP 500; the server remained alive
  Where  server.mjs:55
  Advice Reject empty text with a clear validation message before processing it

SMALL  No limit on login tries
  Tried  Sent 50 wrong logins for synthetic user B, sequentially on localhost
  Saw    All 50 answered without a retry limit
  Where  server.mjs:32
  Advice Apply a bounded retry limit and a clear retry-later response

Copy deleted. Nothing left behind. Break-it changed no code.

ROUND 2 shop-app
Seal: real project unchanged
Attacks: 4 tried   4 blocked   0 got through
Critical holes: 0   ->   Ready for the owner's look

Copy deleted. Nothing left behind. Break-it changed no code.
