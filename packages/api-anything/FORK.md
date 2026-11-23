# api-anything (Greenlit fork)

This folder is a fork of [api-anything](https://github.com/goodnight000/api-anything) 0.4.0
by Tianjun Zheng, MIT licensed (see `LICENSE`, kept unchanged). The upstream commit it starts
from is in `UPSTREAM_COMMIT`.

Greenlit publishes to social platforms through operations learned from their own web and app
requests. Publishing needs to send media, which upstream 0.4.0 cannot (request bodies are text),
so this fork adds, at tier 1 only:

- **File bodies** — `request.file: { param, offset?, length?, contentType? }`: the body is a local
  file (or a byte range of it, for chunked uploads), streamed from disk. The arg is a path, and it
  must resolve inside one of the folders in `API_ANYTHING_FILE_ROOTS` (`:`-separated); a spec
  cannot name a file by default.
- **Multipart bodies with files** — `request.multipart: { fields, files }`: text fields are
  templates (`{param}`), file parts take a path arg under the same rule.
- **Kept response headers** — `response.headers: ["x-goog-upload-url", …]`: the answer is read
  as `{ "headers": { … }, "body": … }`, so extraction paths reach a header an upload start returns.

- **Lookups read from a page** — a derived slot's `from` may carry `response: { format: "embedded",
  embedded: { regex } }`, so a value a site hands out inside its HTML (Instagram's form token) is
  looked up like a JSON one.
- **Plans** — `plan(site, op, args)`: the request a call would send, built with the session's values
  masked and the file body described (paths, sizes, filled fields), never sent. Greenlit's dry runs
  show these instead of sending a write.
- **Protobuf bodies** — `request.protobuf` (base64): the recorded binary body is the template, and
  `pb:<field path>` slot steps write into it (`pb:11.4.1.1.1` = field 11, its field 4, …; the first
  occurrence of each), no schema needed: a field keeps the wire type the recording gave it, and one
  the template lacks is added (a number param as a varint, anything else as bytes). `response.format:
  "protobuf"` reads an answer as JSON keyed by field number (`protobufJson`, also exported for dry
  runs). For apps that speak protobuf (YouTube's Android app).

Operations using any of these never go above tier 1, and shared specs (pulled or published)
may not use them. Everything else is upstream's code. Changes are marked `greenlit fork:`.
