BREAK-IT REPORT shop-app · version 0.6.0
Seal: real project unchanged
Attacks: 26 tried   9 blocked   17 got through

CRITICAL  A secret is stored in configuration
  Tried  Scanned the copy before startup and after the requests
  Saw    A config assignment matched generic api_key  sho…only (31 chars)
  Where  config.mjs:1
  Advice Keep secret values out of source files and build output

CRITICAL  Other people's orders are open
  Tried  Logged in as user A, opened /orders/6 (user B's order)
  Saw    User B's order, item and example delivery address
  Where  server.mjs:209
  Advice Show an order only to the user who owns it

CRITICAL  Profile replies expose a password hash
  Tried  Opened /profile as synthetic user A
  Saw    The reply included a passwordHash field; its value is withheld
  Where  server.mjs:174
  Advice Return only the public profile fields; never return password hashes

CRITICAL  Catalog refresh stops answering under load
  Tried  After one successful request, sent 8 localhost catalog-refresh requests with concurrency 2
  Saw    5 requests failed without an HTTP status
  Where  server.mjs:115
  Advice Release completed catalog work and keep resource use bounded between requests

CRITICAL  Catalog refresh does not recover after the burst
  Tried  Compared the successful pre-burst catalog-refresh request with the final health probe
  Saw    The final request to the same target did not answer with an HTTP status
  Where  server.mjs:116
  Advice Release retained work so new requests still answer after the burst

CRITICAL  An upload can escape its upload folder
  Tried  Uploaded a generated PNG using the one-level traversal name preset
  Saw    Found copy/break-it-escape-657d106e-246a-445d-94b6-39f8174abfda.txt inside the run, outside the app upload folder
  Where  server.mjs:137
  Advice Reject path segments and keep every saved file inside the upload folder

CRITICAL  Uploaded script markers are served inline
  Tried  Uploaded generated HTML and SVG title markers, then fetched the returned file addresses
  Saw    Served inline as text/html and image/svg+xml without attachment or sandboxing CSP
  Where  server.mjs:161
  Advice Serve untrusted active files as attachments or isolate them with a sandboxing policy

CRITICAL  Other people's private uploads are readable
  Tried  Uploaded a generated PNG as user A; fetched its address as user B and without a login
  Saw    User B received HTTP 200; no login received HTTP 401
  Where  server.mjs:155
  Advice Check the file owner before returning any private upload

CRITICAL  Reads outside the upload folder
  Tried  Requested server.mjs one level above uploads inside the copy using ..%2F and %2E%2E%2F
  Saw    server.mjs: HTTP 200 and HTTP 200
  Where  server.mjs:158
  Advice Refuse download names whose resolved paths leave the upload folder before checking file ownership

SMALL  Empty input crashes one request
  Tried  Submitted empty text to /echo
  Saw    HTTP 500; the server remained alive
  Where  server.mjs:199
  Advice Reject empty text with a clear validation message before processing it

SMALL  No limit on login tries
  Tried  Sent 50 wrong logins for synthetic user B, sequentially on localhost
  Saw    All 50 answered without a retry limit
  Where  server.mjs:121
  Advice Apply a bounded retry limit and a clear retry-later response

SMALL  Error replies expose internal details
  Tried  Opened /catalog-error as synthetic user A
  Saw    HTTP 500 included a database error and an internal source path
  Where  server.mjs:178
  Advice Return a plain error message without database or internal path details

SMALL  Login never throttles a concurrent burst
  Tried  Sent 8 wrong logins for synthetic admin with concurrency 2 on localhost
  Saw    The burst answered consistently and its final probe still returned HTTP 401; no retry-later response
  Where  server.mjs:121
  Advice Bound login attempts and return a clear retry-later response to slow password guessing

SMALL  Oversized uploads are accepted
  Tried  Uploaded a generated 20 MiB file to the disposable copy
  Saw    HTTP 201 accepted every byte; the copy stayed healthy
  Where  server.mjs:135
  Advice Reject oversized uploads with a clear 4xx before reading the whole body

SMALL  A cut upload leaves an incomplete file available
  Tried  Uploaded a complete generated archive under 1 MiB, then sent half its multipart body and closed
  Saw    The copy still answered; 50971 of 102039 file bytes remained in uploads and GET served HTTP 200
  Where  server.mjs:136
  Advice Keep the prior file intact and publish an upload only after the complete request has arrived

SMALL  Slow headers have no app time limit
  Tried  Dripped request headers one byte every 500 ms for one second while probing catalog
  Saw    The during and after probes answered HTTP 200; the connection stayed open at our cap and source confirms headersTimeout and requestTimeout are 0
  Where  server.mjs:100
  Advice Set short bounded header and request time limits; F02 and F04 share this one configuration cause

SMALL  An incomplete body has no app time limit
  Tried  Sent ten bytes of a longer JSON body and went silent for one second while probing catalog
  Saw    The during and after probes answered HTTP 200; the connection stayed open at our cap and source confirms headersTimeout and requestTimeout are 0
  Where  server.mjs:100
  Advice Set short bounded header and request time limits; F02 and F04 share this one configuration cause

Same cause: A09, D02 point to server.mjs:121; one fix may close both.
Same cause: F02, F04 point to server.mjs:100; one fix may close both.

Skipped (not counted)
  E02    Claimed-type case covered by separate upload tests
  E05    Shop stores archives without unpacking them; archive bytes covered by separate tests
  E06    Empty and truncated PNG cases covered by separate upload tests

Copy deleted. Nothing left behind. Break-it changed no code.

ROUND 2 shop-app
Seal: real project unchanged
Attacks: 26 tried   26 blocked   0 got through
Critical holes: 0   ->   Ready for the owner's look

Skipped (not counted)
  E02    Claimed-type case covered by separate upload tests
  E05    Shop stores archives without unpacking them; archive bytes covered by separate tests
  E06    Empty and truncated PNG cases covered by separate upload tests

Copy deleted. Nothing left behind. Break-it changed no code.
