// greenlit fork: file and multipart request bodies, and kept response headers (FORK.md).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { callTiers } from "../src/execute.js";
import { send } from "../src/http.js";
import type { Session } from "../src/session.js";
import { type Operation, OperationSchema, SiteSchema } from "../src/spec.js";
import { vetShared } from "../src/vet.js";

const HOME = mkdtempSync(join(tmpdir(), "api-anything-files-"));
const ROOT = join(HOME, "media");
const OUTSIDE = join(HOME, "private");
mkdirSync(ROOT);
mkdirSync(OUTSIDE);
process.env.API_ANYTHING_HOME = HOME;
process.env.API_ANYTHING_FILE_ROOTS = ROOT;
after(() => rmSync(HOME, { recursive: true, force: true }));

const CLIP = join(ROOT, "clip.mp4");
writeFileSync(CLIP, Buffer.from("0123456789abcdefghij"));
writeFileSync(join(OUTSIDE, "secret.txt"), "do not send");
symlinkSync(join(OUTSIDE, "secret.txt"), join(ROOT, "link.txt"));

const session: Session = { cookies: [], values: { dtsg: "TOKEN" } };

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}
const capture = (answer: () => Response) => {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body });
    return answer();
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
};

const upload = (over: Record<string, unknown> = {}): Operation =>
  OperationSchema.parse({
    name: "uploadChunk",
    request: {
      method: "post",
      url: "https://upload.example.com/upload?id=1",
      headers: { "content-type": "application/octet-stream" },
      file: { param: "path", offset: "offset", length: "length" },
    },
    slots: [],
    params: [{ name: "path" }, { name: "offset", type: "number" }, { name: "length", type: "number" }],
    response: { format: "json" },
    trigger: { url: "https://upload.example.com/" },
    readOnly: false,
    ...over,
  });

test("a file body sends the byte range of the file the path arg names", async () => {
  const { seen, fetchImpl } = capture(() => Response.json({ ok: true }));
  const r = await send(upload(), { path: CLIP, offset: 5, length: 4 }, session, {
    site: "files",
    fetchImpl,
    minIntervalMs: 0,
  });
  assert.equal(r.status, 200);
  assert.equal(seen.length, 1);
  const body = seen[0]!.body as Blob;
  assert.ok(body instanceof Blob);
  assert.equal(await body.text(), "56789".slice(0, 4));
  assert.equal(seen[0]!.headers["content-type"], "application/octet-stream");
});

test("a file body without a range sends the whole file", async () => {
  const { seen, fetchImpl } = capture(() => Response.json({ ok: true }));
  const op = upload({
    request: { method: "put", url: "https://upload.example.com/u", headers: {}, file: { param: "path" } },
    params: [{ name: "path" }],
  });
  await send(op, { path: CLIP }, session, { site: "files", fetchImpl, minIntervalMs: 0 });
  assert.equal(await (seen[0]!.body as Blob).text(), "0123456789abcdefghij");
});

test("a path outside API_ANYTHING_FILE_ROOTS, or a link leading out of them, is refused and nothing is sent", async () => {
  const { seen, fetchImpl } = capture(() => Response.json({ ok: true }));
  const op = upload({
    request: { method: "put", url: "https://upload.example.com/u", headers: {}, file: { param: "path" } },
    params: [{ name: "path" }],
  });
  await assert.rejects(
    send(op, { path: join(OUTSIDE, "secret.txt") }, session, { site: "files", fetchImpl, minIntervalMs: 0 }),
    /outside API_ANYTHING_FILE_ROOTS/,
  );
  await assert.rejects(
    send(op, { path: join(ROOT, "link.txt") }, session, { site: "files", fetchImpl, minIntervalMs: 0 }),
    /outside API_ANYTHING_FILE_ROOTS/,
  );
  assert.equal(seen.length, 0);
});

test("a file param may not have a default: a spec cannot pick the file", async () => {
  const { seen, fetchImpl } = capture(() => Response.json({ ok: true }));
  const op = upload({
    request: { method: "put", url: "https://upload.example.com/u", headers: {}, file: { param: "path" } },
    params: [{ name: "path", required: false, default: CLIP }],
  });
  await assert.rejects(send(op, {}, session, { site: "files", fetchImpl, minIntervalMs: 0 }), /default/);
  assert.equal(seen.length, 0);
});

test("a multipart body fills text fields from args and session values, and attaches the file", async () => {
  const { seen, fetchImpl } = capture(() => Response.json({ ok: true }));
  const op = upload({
    request: {
      method: "post",
      url: "https://upload.example.com/photo",
      headers: { "content-type": "multipart/form-data; boundary=OLD" },
      multipart: {
        fields: { fb_dtsg: "{session:dtsg}", target: "{target}", fixed: "1" },
        files: [{ name: "farr", param: "path", filename: "photo.jpg", contentType: "image/jpeg" }],
      },
    },
    params: [{ name: "path" }, { name: "target" }],
  });
  await send(op, { path: CLIP, target: "42" }, session, { site: "files", fetchImpl, minIntervalMs: 0 });
  const form = seen[0]!.body as FormData;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("fb_dtsg"), "TOKEN");
  assert.equal(form.get("target"), "42");
  assert.equal(form.get("fixed"), "1");
  const file = form.get("farr") as File;
  assert.equal(file.name, "photo.jpg");
  assert.equal(file.type, "image/jpeg");
  assert.equal(await file.text(), "0123456789abcdefghij");
  // fetch writes the boundary itself: the template's content type must not go
  assert.equal(seen[0]!.headers["content-type"], undefined);
});

test("kept response headers are read as {headers, body}", async () => {
  const { fetchImpl } = capture(
    () =>
      new Response('{"status":"active"}', {
        headers: { "content-type": "application/json", "x-goog-upload-url": "https://up/1", other: "no" },
      }),
  );
  const op = OperationSchema.parse({
    name: "start",
    request: { method: "post", url: "https://upload.example.com/start", headers: {}, body: "{}" },
    slots: [],
    params: [],
    response: { format: "json", headers: ["X-Goog-Upload-URL"] },
    trigger: { url: "https://upload.example.com/" },
    readOnly: false,
  });
  const r = await send(op, {}, session, { site: "files", fetchImpl, minIntervalMs: 0 });
  const data = JSON.parse(r.body);
  assert.deepEqual(data, { headers: { "x-goog-upload-url": "https://up/1" }, body: { status: "active" } });
  assert.match(r.headers["content-type"]!, /json/);
});

test("ops with file or multipart bodies stay at tier 1", () => {
  const site = SiteSchema.parse({ name: "files", baseUrl: "https://upload.example.com", operations: [upload()] });
  assert.deepEqual(callTiers(site, site.operations[0]!, 3), { tier: 1, maxTier: 1 });
});

test("a shared spec may not use file bodies, multipart files or kept headers", () => {
  const site = SiteSchema.parse({ name: "files", baseUrl: "https://upload.example.com", operations: [upload()] });
  const v = vetShared(site);
  assert.ok(v.errors.some((e) => /local only/.test(e)));
});

test("a sapisidhash slot sends Google's SAPISIDHASH for each request, from the session's SAPISID cookies", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
  const { createHash } = await import("node:crypto");
  const { buildRequest } = await import("../src/http.js");
  const op = OperationSchema.parse({
    name: "channels",
    request: {
      method: "post",
      url: "https://www.youtube.com/youtubei/v1/account/accounts_list",
      headers: { "x-origin": "https://www.youtube.com", authorization: "" },
      body: "{}",
    },
    slots: [{ gen: "sapisidhash", at: ["header:authorization"] }],
    params: [],
    trigger: { url: "https://www.youtube.com/" },
    readOnly: true,
  });
  const cookie = (name: string, value: string) => ({ name, value, domain: ".youtube.com", path: "/", expires: -1, httpOnly: false, secure: true });
  const s: Session = { cookies: [cookie("SAPISID", "abc"), cookie("__Secure-3PAPISID", "xyz")], values: {} };
  const req = buildRequest(op, {}, s);
  const ts = 1_700_000_000;
  const h = (v: string) => createHash("sha1").update(`${ts} ${v} https://www.youtube.com`).digest("hex");
  assert.equal(req.headers.authorization, `SAPISIDHASH ${ts}_${h("abc")} SAPISID3PHASH ${ts}_${h("xyz")}`);
  const site = SiteSchema.parse({ name: "yt", baseUrl: "https://www.youtube.com", operations: [op] });
  assert.ok(vetShared(site).errors.some((e) => /local only/.test(e)));
});

test("a GraphQL answer streamed one JSON value per line is put back together (@stream items, @defer data)", async () => {
  const { parseBody } = await import("../src/extract.js");
  const lines = [
    { data: { node: { feed: { edges: [{ node: { id: "1", media: { url: "a" } } }] } } } },
    { label: "media$defer", path: ["node", "feed", "edges", 0, "node", "media"], data: { dubbed: true } },
    { label: "feed$stream", path: ["node", "feed", "edges", 1], data: { node: { id: "2" }, cursor: "c2" } },
    { label: "feed$stream", path: ["node", "feed", "edges", 2], data: { node: { id: "3" }, cursor: "c3" } },
    { label: "feed$defer", path: ["node", "feed"], data: { page_info: { end_cursor: "c3", has_next_page: true } } },
  ];
  const body = lines.map((l) => JSON.stringify(l)).join("\r\n");
  const out = parseBody(body) as { data: { node: { feed: { edges: { node: { id: string } }[]; page_info: unknown } } } };
  assert.deepEqual(out.data.node.feed.edges.map((e) => e.node.id), ["1", "2", "3"]);
  assert.deepEqual((out.data.node.feed.edges[0]!.node as unknown as { media: unknown }).media, { url: "a", dubbed: true });
  assert.deepEqual(out.data.node.feed.page_info, { end_cursor: "c3", has_next_page: true });
  // lines that are not incremental delivery come back as a list; one value stays itself
  assert.deepEqual(parseBody('{"a":1}\n{"b":2}'), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(parseBody('{"a":1}'), { a: 1 });
});

// greenlit fork: plans — the request a call would send, built and described, never sent.
test("a plan builds the request with the session masked and describes the file body", async () => {
  const { plan } = await import("../src/plan.js");
  const { saveSite } = await import("../src/store.js");
  const { saveSession } = await import("../src/session.js");
  saveSite(
    SiteSchema.parse({
      name: "plan-test",
      baseUrl: "https://upload.example.com",
      operations: [
        {
          name: "post",
          readOnly: false,
          request: {
            method: "POST",
            url: "https://upload.example.com/post",
            headers: { "content-type": "multipart/form-data; boundary=OLD" },
            multipart: {
              fields: { caption: "{caption}", token: "{cookie:csrf}" },
              files: [{ name: "media", param: "path", filename: "clip.mp4", contentType: "video/mp4" }],
            },
          },
          slots: [],
          params: [{ name: "caption" }, { name: "path" }],
          response: { format: "json" },
          trigger: { url: "https://upload.example.com/" },
        },
      ],
    }),
  );
  saveSession("plan-test", {
    cookies: [{ name: "csrf", value: "REAL-SECRET", domain: "upload.example.com", path: "/", expires: -1, httpOnly: false, secure: true }],
    values: {},
  });
  const p = plan("plan-test", "post", { caption: "hello", path: CLIP });
  assert.equal(p.readOnly, false);
  assert.equal(p.request.method, "POST");
  assert.deepEqual(p.body?.fields, { caption: "hello", token: "<csrf>" });
  assert.equal(p.body?.files?.[0]?.bytes, 20);
  assert.equal(p.body?.files?.[0]?.filename, "clip.mp4");
  assert.ok(!JSON.stringify(p).includes("REAL-SECRET"));
  assert.throws(() => plan("plan-test", "post", { caption: "x", path: join(ROOT, "link.txt") }), /outside/);
  assert.throws(() => plan("plan-test", "nope", {}), /no operation/);
});

// greenlit fork: a lookup whose answer is a page with the value in embedded JSON (Instagram's form token).
test("a lookup reads a value from JSON embedded in an HTML page", async () => {
  const { derive } = await import("../src/lookup.js");
  const op = OperationSchema.parse({
    name: "profile",
    request: { method: "POST", url: "https://site.example.com/api/graphql", body: "fb_dtsg=x&doc_id=1" },
    slots: [
      {
        at: ["form:fb_dtsg"],
        from: {
          request: { method: "GET", url: "https://site.example.com/", headers: { accept: "text/html" } },
          response: { format: "embedded", embedded: { regex: '"DTSGInitialData",\\[\\],(\\{)' } },
        },
        path: "token",
      },
    ],
    params: [],
    response: { format: "json" },
    trigger: { url: "https://site.example.com/" },
    readOnly: true,
  });
  const page = '<html><script>require([["DTSGInitialData",[],{"token":"NAfAbc123:45:1700000000"},258]])</script></html>';
  const out = await derive(op, async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: page }) as never);
  assert.equal(new URLSearchParams(out.request.body).get("fb_dtsg"), "NAfAbc123:45:1700000000");
  assert.throws(() =>
    OperationSchema.parse({ ...op, slots: [{ ...op.slots[0], from: { ...op.slots[0]!.from, response: { format: "embedded" } } }] }),
  );
});

// greenlit fork: protobuf bodies (YouTube's Android app speaks protobuf).
test("protobuf: a field path edit keeps the rest of the message byte for byte", async () => {
  const pb = await import("../src/protobuf.js");
  // {1: {1: "client", 2: 21}, 2: {1: {1: "old-id"}}, 3: "upload-1", 4: 3}
  const inner = pb.encode([{ f: 1, w: 2, v: new TextEncoder().encode("old-id") }]);
  const msg = pb.encode([
    { f: 1, w: 2, v: pb.encode([{ f: 1, w: 2, v: new TextEncoder().encode("client") }, { f: 2, w: 0, v: 21n }]) },
    { f: 2, w: 2, v: pb.encode([{ f: 1, w: 2, v: inner }]) },
    { f: 3, w: 2, v: new TextEncoder().encode("upload-1") },
    { f: 4, w: 0, v: 3n },
  ]);
  const out = pb.setField(msg, "2.1.1", "new-resource-id");
  assert.equal(pb.getField(out, "2.1.1"), "new-resource-id");
  assert.equal(pb.getField(out, "1.1"), "client");
  assert.equal(pb.getField(pb.setField(out, "4", 7), "4"), "7");
  assert.deepEqual(pb.toJson(out), { 1: { 1: "client", 2: 21 }, 2: { 1: { 1: "new-resource-id" } }, 3: "upload-1", 4: 3 });
  // a field the template lacks is added, with the messages above it
  assert.equal(pb.getField(pb.setField(msg, "9.2", "x"), "9.2"), "x");
  assert.throws(() => pb.setField(msg, "4", "not a number"), /holds a number/);
});

test("protobuf: a fixed32 field takes a number as a float (a volume)", async () => {
  const pb = await import("../src/protobuf.js");
  const one = new Uint8Array(new Float32Array([1]).buffer);
  const msg = pb.encode([{ f: 4, w: 2, v: pb.encode([{ f: 2, w: 5, v: one }]) }]);
  const out = pb.setField(msg, "4.2", 0.25);
  const field = pb.decode(pb.decode(out)!.find((x) => x.f === 4)!.v as Uint8Array)![0]!;
  assert.equal(field.w, 5);
  assert.equal(new DataView((field.v as Uint8Array).slice().buffer).getFloat32(0, true), 0.25);
  assert.throws(() => pb.setField(msg, "4.2", "loud"));
});

test("protobuf: a pb: slot fills the template, the body goes as bytes, the answer reads as JSON", async () => {
  const pb = await import("../src/protobuf.js");
  const template = Buffer.from(
    pb.encode([{ f: 2, w: 2, v: pb.encode([{ f: 1, w: 2, v: new TextEncoder().encode("x") }]) }, { f: 3, w: 2, v: new TextEncoder().encode("y") }]),
  ).toString("base64");
  const op = OperationSchema.parse({
    name: "createvideo",
    request: { method: "POST", url: "https://api.example.com/upload/createvideo", headers: { "content-type": "application/x-protobuf" }, protobuf: template },
    slots: [
      { param: "resourceId", at: ["pb:2.1"] },
      { param: "uploadId", at: ["pb:3"] },
      { param: "nanos", at: ["pb:4.2"] },
    ],
    params: [{ name: "resourceId" }, { name: "uploadId" }, { name: "nanos", type: "number" }],
    response: { format: "protobuf", extract: "2" },
    trigger: { url: "https://api.example.com/" },
    readOnly: false,
  });
  const answer = pb.encode([{ f: 2, w: 2, v: new TextEncoder().encode("VIDEO123") }]);
  const { seen, fetchImpl } = capture(() => new Response(Buffer.from(answer), { status: 200, headers: { "content-type": "application/x-protobuf" } }));
  const r = await send(op, { resourceId: "RES", uploadId: "UP", nanos: 500 }, session, { site: "pb-test", fetchImpl, minIntervalMs: 0 });
  const sent = new Uint8Array(seen[0]!.body as Buffer);
  assert.equal(pb.getField(sent, "2.1"), "RES");
  assert.equal(pb.getField(sent, "3"), "UP");
  // a number the template lacks is added as a varint, not as its digits
  const added = pb.decode(pb.decode(sent)!.find((x) => x.f === 4)!.v as Uint8Array)!;
  assert.deepEqual(added, [{ f: 2, w: 0, v: 500n }]);
  const { extract } = await import("../src/extract.js");
  assert.equal(extract(op.response, r.body), "VIDEO123");
});

// greenlit fork: Instagram's app requests (a JSON body behind SIGNATURE. in a form field, the IGT header).
test("instagram: a prefix: step reaches JSON behind SIGNATURE., and gen igt sends the session in the app's header", async () => {
  const op = OperationSchema.parse({
    name: "configure",
    request: {
      method: "POST",
      url: "https://i.instagram.com/api/v1/media/configure_to_clips/",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "signed_body=" + encodeURIComponent('SIGNATURE.{"caption":"x","clips_audio_metadata":"{\\"song\\":{\\"volume_level\\":1}}"}'),
    },
    slots: [
      { gen: "igt", at: ["header:authorization"] },
      { param: "caption", at: ["form:signed_body", "prefix:SIGNATURE.", "json:/caption"] },
      { param: "songVolume", at: ["form:signed_body", "prefix:SIGNATURE.", "json:/clips_audio_metadata", "json:/song/volume_level"] },
    ],
    params: [{ name: "caption" }, { name: "songVolume", type: "number" }],
    response: { format: "json" },
    trigger: { url: "https://www.instagram.com/" },
    readOnly: false,
  });
  const ig: Session = {
    cookies: [
      { name: "sessionid", value: "123%3Aabc%3A4", domain: ".instagram.com", path: "/", expires: -1, httpOnly: true, secure: true },
      { name: "ds_user_id", value: "123", domain: ".instagram.com", path: "/", expires: -1, httpOnly: false, secure: true },
    ],
    values: {},
  };
  const { seen, fetchImpl } = capture(() => new Response('{"status":"ok"}', { status: 200, headers: { "content-type": "application/json" } }));
  await send(op, { caption: "Trullo", songVolume: 0.4 }, ig, { site: "ig-test", fetchImpl, minIntervalMs: 0 });
  const auth = seen[0]!.headers.authorization as string;
  assert.match(auth, /^Bearer IGT:2:/);
  assert.deepEqual(JSON.parse(Buffer.from(auth.slice(13), "base64").toString()), { ds_user_id: "123", sessionid: "123:abc:4" });
  const form = new URLSearchParams(String(seen[0]!.body));
  const signed = form.get("signed_body")!;
  assert.ok(signed.startsWith("SIGNATURE."));
  const j = JSON.parse(signed.slice(10));
  assert.equal(j.caption, "Trullo");
  assert.equal(JSON.parse(j.clips_audio_metadata).song.volume_level, 0.4);
});

// greenlit fork: a field sent only when it applies (Instagram's AI label), left out when its value is empty.
test("omitEmpty: an empty value leaves the JSON member out; a value writes it", async () => {
  const { withoutMember } = await import("../src/codec.js");
  assert.equal(withoutMember('{"a":1,"b":2,"c":3}', "/b"), '{"a":1,"c":3}');
  assert.equal(withoutMember('{"a":1,"b":2}', "/b"), '{"a":1}');
  assert.equal(withoutMember('{"b":2}', "/b"), "{}");
  assert.equal(withoutMember('{"a":{"x":"1","y":2}}', "/a/x"), '{"a":{"y":2}}');
  assert.equal(withoutMember('{"a":1}', "/z"), '{"a":1}');
  const op = OperationSchema.parse({
    name: "configure",
    request: {
      method: "POST",
      url: "https://i.instagram.com/api/v1/media/configure/",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "signed_body=" + encodeURIComponent('SIGNATURE.{"caption":"x","gen_ai_detection_method":"SELF_DISCLOSURE_FLOW","upload_id":"1"}'),
    },
    slots: [
      { param: "ai", omitEmpty: true, at: ["form:signed_body", "prefix:SIGNATURE.", "json:/gen_ai_detection_method"] },
    ],
    params: [{ name: "ai", required: false, default: "" }],
    response: { format: "json" },
    trigger: { url: "https://www.instagram.com/" },
    readOnly: false,
  });
  const session: Session = { cookies: [], values: {} };
  const sent = async (args: Record<string, unknown>) => {
    const { seen, fetchImpl } = capture(() => new Response('{"status":"ok"}', { status: 200, headers: { "content-type": "application/json" } }));
    await send(op, args, session, { site: "omit-test", fetchImpl, minIntervalMs: 0 });
    return JSON.parse(new URLSearchParams(String(seen[0]!.body)).get("signed_body")!.slice(10));
  };
  assert.deepEqual(await sent({}), { caption: "x", upload_id: "1" });
  assert.deepEqual(await sent({ ai: "SELF_DISCLOSURE_FLOW" }), { caption: "x", gen_ai_detection_method: "SELF_DISCLOSURE_FLOW", upload_id: "1" });
});

// greenlit fork: an op sent as an app sends it, without the session's cookies; a cookie ref still reads the session.
test("cookies: false sends no Cookie header, and a cookie ref still fills its slot", async () => {
  const op = OperationSchema.parse({
    name: "share",
    cookies: false,
    request: { method: "POST", url: "https://i.instagram.com/api/v1/media/configure_sidecar/", headers: { "content-type": "application/json" }, body: '{"_uid":"0"}' },
    slots: [{ ref: "cookie:ds_user_id", at: ["body", "json:/_uid"] }],
    response: { format: "json" },
    trigger: { url: "https://www.instagram.com/" },
    readOnly: false,
  });
  const ig: Session = {
    cookies: [{ name: "ds_user_id", value: "123", domain: ".instagram.com", path: "/", expires: -1, httpOnly: false, secure: true }],
    values: {},
  };
  const { seen, fetchImpl } = capture(() => new Response('{"status":"ok"}', { status: 200, headers: { "content-type": "application/json" } }));
  await send(op, {}, ig, { site: "nocookie-test", fetchImpl, minIntervalMs: 0 });
  assert.equal(seen[0]!.headers.cookie, undefined);
  assert.equal(JSON.parse(String(seen[0]!.body))._uid, "123");
});
