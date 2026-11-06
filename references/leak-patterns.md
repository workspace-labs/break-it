# Built-in leak patterns

## Contents

- [Pattern list](#pattern-list)
- [Generic assignment rule](#generic-assignment-rule)
- [Output and limits](#output-and-limits)

`scan`, `mask`, and the report guard share a small built-in list. No lists are
downloaded and no candidate is checked against an external provider. Matches are
working-looking candidates, not proof that a credential is live. These checks
run only on the owner's throwaway copy or on text piped from that copy.

## Pattern list

- **private key:** a `-----BEGIN PRIVATE KEY-----` header, optionally with
  uppercase letter/digit labels before PRIVATE (for example RSA, EC, DSA,
  OPENSSH or ENCRYPTED). The match covers the whole block through its END header,
  or the remaining text if END is absent. A header is enough to flag it; no
  private-key body is printed.
- **GitHub ghp:** `ghp_` followed by at least 36 letters/digits.
- **GitHub github_pat:** `github_pat_` followed by at least 22
  letters/digits/underscores.
- **Slack xox:** `xox[baprs]-` followed by at least 10 token characters
  (letters, digits or hyphens).
- **AWS AKIA:** `AKIA` followed by exactly 16 uppercase letters/digits.
- **OpenAI sk:** `sk-` followed by at least 20 letters, digits,
  underscores or hyphens.
- **Stripe sk_live:** `sk_live_` followed by at least 16 letters/digits.
- **JWT:** three dot-separated base64url segments, each at least 8 characters;
  the first starts with `eyJ`. A token may start after a hyphen within a longer
  base64url run; trailing hyphens in the last segment are excluded, preserving
  the existing word-boundary behavior. This recognizes a shape, without decoding data.
- **generic `<field>`:** a sensitive field name assigned a quoted or unquoted
  value with `=` or `:`, under the exact rules below. Candidates need at least
  9 characters. Output names the full field in lowercase, such as
  `generic db_password` or `generic apikey`.

Word boundaries delimit provider shapes. When matches
overlap, the containing assignment or private-key block wins over a provider
match inside it. Partially overlapping spans are merged to avoid exposing any
part of a private-key body. Values documented as placeholders
are ignored: empty values, exact `example` or `changeme`, `your-…-here` forms,
and values made only from `x` characters. The `your` placeholder also accepts
underscores in place of hyphens. Matching is case-insensitive for these
placeholder checks. An EXAMPLE substring inside a longer synthetic key does not
exempt it; the shop example deliberately uses that control distinction.

## Generic assignment rule

Field names contain 1–128 ASCII characters: they start with a letter, `_` or `$`
and then use letters, digits, `_`, `$`, `-` and `.`. A name can start only at
the beginning of input or after a character outside `[\w$.-]`; a long name run
is never retried from each character or shortened to a sensitive suffix. Names
longer than 128 characters are outside this rule. Sensitive words can be
the whole name or a component of a longer name, delimited by `_`, `-`, `.`, or a
camelCase/PascalCase transition. Names are checked case-insensitively after
tokenization. The sensitive words are `password`, `passwd`, `pwd`, `secret`,
`token`, `auth`, `credential` and `credentials`; compound forms include
`api_key`, `api-key`, `apikey`, `private_key` and `password_hash`, including their
separated and camelCase/PascalCase equivalents. The unseparated words `apikey`,
`privatekey` and `passwordhash` also qualify. Examples include `DB_PASSWORD`,
`STRIPE_SECRET_KEY`, `x-api-key`, `db.password`, `apiKey`, `accessToken`,
`clientSecret`, `DbPassword` and `passwordHash`. A word merely containing those
letters without a recognized boundary does not qualify.

The name must be followed by `=` or `:` and a value; `==` and `=>` are not
assignment delimiters for this rule. Quoted field names, JSON,
minified text and an `export` declaration are supported. Prose such as “the
token expired today” has no assignment and never matches.

- Quoted values use matching single/double quotes or backticks, with escaped
  delimiters and other quote types inside. Values cannot cross a line break;
  written escapes are inspected without decoding. A missing closing quote at
  end of input is conservatively treated as a candidate, including when a CLI
  reply was cut at its display cap.
- Unquoted values extend to end of line or the first whitespace or `#` comment.
  An empty assignment never consumes an unquoted field from the following line;
  quoted literals may still follow assignment whitespace across a line break.
  Only the value is masked, never its surrounding assignment or whole line.
- Scan, history masking and report validation keep the 9-character minimum.
  CLI reply display also masks shorter named credential values; 8 characters
  or fewer use bullets.

Object literals are containers: their inner named assignments are inspected
instead of consuming an inner field name as the parent's scalar value. Quoted
object keys may contain punctuation, Unicode or escaped delimiters; they are not
limited to the generic credential-name length. Arrays with object entries also
leave inner named fields visible to inspection. Existing scalar-array and
brace-wrapped scalar candidates retain their masking behavior.

Assignment-like text inside an already consumed quoted scalar remains part of that
value; it is not retried as a second generic field. If a quoted value cannot be
parsed, its remaining line is not retried for nested generic assignments.
A separate statement after an ignored
unquoted read's comma or semicolon can still be inspected. These rules keep
repeated field-like text from repeatedly rescanning the same long value.

Values starting with `process.env` or `os.environ` (followed by a word boundary
or `[`), or with `${`, `{{` or `<`, are ignored as reads/templates. Values exactly
`null`, `undefined`, `true` or `false` are ignored case-insensitively. These
ignores apply to quoted and unquoted values. Trailing commas/semicolons are
removed only to classify these references, not from a reported value.

For unquoted values only, a bare identifier made entirely of letters, with no
digits or punctuation, is a reference, as in `token = getToken`. Plain dotted
references such as `config.secret`, `settings.db.password`, `this.token` and
`env.API_KEY` are also ignored. A dotted reference has at least two nonempty
identifier parts joined by single dots; each part starts with a letter, `_` or
`$` and contains only letters, `_` or `$`. No part may contain a digit. A
digit-bearing name is not exempted by this rule and remains a candidate when
it meets the 9-character minimum and no other ignore applies.
For this dotted-reference check only, closing `}` characters attached to the
unquoted value are ignored, so compact object syntax has the same result.
Function calls beginning with an identifier or a dotted identifier and `(` are
also ignored, as in `password = getPassword()`. Quoted alphabetic strings, dotted
strings and strings that look like function calls remain literal candidates,
subject to the other ignores. The original placeholder rules above still apply. These choices keep
code that reads a credential from being reported as a stored literal one.

## Output and limits

Every hit uses first 3 characters + `…` + last 4 plus length, such as
`sk-…a91f (51 chars)`. Values of 8 characters or fewer use `•••• (N chars)`.
Never print or store the original value in findings, reports or review notes.

`scan <run-id>` reads only that guarded run's `copy`. A hit is
`<relative file>:<line>  <pattern name>  <masked value>`. `.git` is skipped for
C02, binaries are detected per window, and symbolic links are not followed.
Text files up to 20 MiB are read in 1 MiB windows with at most 4 KiB of overlap,
starting on a complete UTF-8 character. Hits repeated
in overlap are emitted once, with line numbers relative to the whole file.
Files above 20 MiB are skipped with the plain note
`Skipped for size (over 20 MiB): <file>`. Invalid UTF-8 or binary content in a
later window discards that file's pending hits; partial file results are not
published. If an unfinished secret candidate crosses a window boundary and
starts before the retained overlap, the whole file is marked incomplete with
`Skipped long boundary-spanning match (over 4 KiB overlap): <file>` instead of
printing a truncated value. Treat a skipped file as untested.
`No secrets found` with
exit 0 means only that the inspected text had no matching candidate; it does not
erase skip notes or certify the project.

`mask` reads stdin up to 20 MiB, stops with a plain note at that cap, and
prints only masked hits. With git patch input, each hit includes the nearest
preceding `commit <hash>` shortened to 7 characters and `+++ b/<file>` path,
with the historical line obtained from the patch hunk counters. Deleted lines
use the old side's line; added/context lines use the corresponding new line.
It prints no other input lines or context. Pipe history directly into it; never
save or display the unmasked stream.

The list does not cover arbitrary encodings, concatenated/split values, every
provider, password-hash format, or all personal data. C03–C05 also require the
reviewer's contract/field observations. Limits and skips are incomplete coverage,
not evidence that a leak was blocked. Never broaden a run beyond localhost or
the copy to compensate for scanner limits.
