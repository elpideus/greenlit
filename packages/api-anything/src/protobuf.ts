// greenlit fork: protobuf bodies. Some apps (YouTube's Android app) speak protobuf, not JSON. A spec keeps the
// recorded request as its template (`request.protobuf`, base64) and slots write into it by field path
// (`pb:2.1.1` = field 2, its field 1, its field 1; the first occurrence of each). No schema is needed: a field
// keeps the wire type the recording gave it. Answers can be read as JSON keyed by field number
// (`response.format: "protobuf"`).

export type Field = { f: number; w: number; v: bigint | Uint8Array };

function readVarint(b: Uint8Array, i: number): [bigint, number] {
  let v = 0n;
  let s = 0n;
  for (;;) {
    if (i >= b.length) throw new Error("protobuf: varint past the end");
    const c = b[i++]!;
    v |= BigInt(c & 0x7f) << s;
    s += 7n;
    if (c < 0x80) return [v, i];
    if (s > 70n) throw new Error("protobuf: varint too long");
  }
}

function writeVarint(n: bigint): number[] {
  const out: number[] = [];
  let v = BigInt.asUintN(64, n);
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return out;
}

/** The fields of a message, or null when the bytes are not one. */
export function decode(b: Uint8Array): Field[] | null {
  const out: Field[] = [];
  let i = 0;
  try {
    while (i < b.length) {
      const [key, j] = readVarint(b, i);
      i = j;
      const f = Number(key >> 3n);
      const w = Number(key & 7n);
      if (f === 0) return null;
      if (w === 0) {
        const [v, k] = readVarint(b, i);
        out.push({ f, w, v });
        i = k;
      } else if (w === 2) {
        const [n, k] = readVarint(b, i);
        const end = k + Number(n);
        if (end > b.length) return null;
        out.push({ f, w, v: b.subarray(k, end) });
        i = end;
      } else if (w === 1 || w === 5) {
        const end = i + (w === 1 ? 8 : 4);
        if (end > b.length) return null;
        out.push({ f, w, v: b.subarray(i, end) });
        i = end;
      } else return null;
    }
  } catch {
    return null;
  }
  return out;
}

export function encode(fields: Field[]): Uint8Array {
  const parts: number[] = [];
  for (const { f, w, v } of fields) {
    parts.push(...writeVarint(BigInt(f) * 8n + BigInt(w)));
    if (w === 0) parts.push(...writeVarint(v as bigint));
    else if (w === 2) {
      const bytes = v as Uint8Array;
      parts.push(...writeVarint(BigInt(bytes.length)));
      for (const x of bytes) parts.push(x);
    } else for (const x of v as Uint8Array) parts.push(x);
  }
  return Uint8Array.from(parts);
}

const parsePath = (path: string) =>
  path.split(".").map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1) throw new Error(`protobuf: "${path}" is not a field path (2.1.1)`);
    return n;
  });

/** The value at a field path: a varint as a string of digits, a length-delimited field as UTF-8 text. */
export function getField(b: Uint8Array, path: string): string | undefined {
  let cur: Uint8Array = b;
  const steps = parsePath(path);
  for (let i = 0; i < steps.length; i++) {
    const field = decode(cur)?.find((x) => x.f === steps[i]);
    if (!field) return undefined;
    if (i === steps.length - 1) return field.w === 0 ? String(field.v) : new TextDecoder().decode(field.v as Uint8Array);
    if (field.w !== 2) return undefined;
    cur = field.v as Uint8Array;
  }
  return undefined;
}

/**
 * The message with `value` written at a field path. A field keeps its recorded wire type: a varint field takes a
 * whole number, a length-delimited one the value's UTF-8 bytes, a fixed32 / fixed64 one a float / double. A field
 * the template lacks is added (a number as a varint, anything else as bytes), and so are the messages above it.
 */
export function setField(b: Uint8Array, path: string, value: string | number | bigint): Uint8Array {
  return setSteps(b, parsePath(path), value, path);
}

function setSteps(b: Uint8Array, steps: number[], value: string | number | bigint, path: string): Uint8Array {
  const fields = decode(b);
  if (!fields) throw new Error(`protobuf: no message on the way to ${path}`);
  const [head, ...rest] = steps;
  const i = fields.findIndex((x) => x.f === head);
  if (!rest.length) {
    const asNumber = typeof value !== "string" || /^-?\d+$/.test(value);
    const w = i >= 0 ? fields[i]!.w : asNumber && typeof value !== "string" ? 0 : 2;
    let v: bigint | Uint8Array;
    if (w === 0) {
      if (!asNumber) throw new Error(`protobuf: ${path} holds a number, not ${JSON.stringify(value)}`);
      v = BigInt(value);
    } else if (w === 2) v = new TextEncoder().encode(String(value));
    else {
      // A fixed-width field takes a number as a float (fixed32) or a double (fixed64): apps keep volumes so.
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`protobuf: ${path} holds a number, not ${JSON.stringify(value)}`);
      const view = new DataView(new ArrayBuffer(w === 5 ? 4 : 8));
      if (w === 5) view.setFloat32(0, n, true);
      else view.setFloat64(0, n, true);
      v = new Uint8Array(view.buffer);
    }
    const field = { f: head!, w, v };
    if (i >= 0) fields[i] = field;
    else fields.push(field);
    return encode(fields);
  }
  if (i >= 0 && fields[i]!.w !== 2) throw new Error(`protobuf: ${path} goes through a field that is not a message`);
  const inner = setSteps(i >= 0 ? (fields[i]!.v as Uint8Array) : new Uint8Array(), rest, value, path);
  if (i >= 0) fields[i] = { ...fields[i]!, v: inner };
  else fields.push({ f: head!, w: 2, v: inner });
  return encode(fields);
}

const textOf = (v: Uint8Array): string | undefined => {
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(v);
    return /^[\P{C}\n\r\t]*$/u.test(s) ? s : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A message as JSON keyed by field number: a varint as a number (or a string past 2^53), text as a string, a
 * nested message as an object (a length-delimited field is read as a message when it parses as one and is not
 * plain text), other bytes as base64. A field that repeats becomes an array.
 */
export function toJson(b: Uint8Array, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { f, w, v } of decode(b) ?? []) {
    let value: unknown;
    if (w === 0) {
      const n = v as bigint;
      value = n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : String(n);
    } else if (w === 2) {
      const bytes = v as Uint8Array;
      const text = textOf(bytes);
      const sub = depth < 40 && bytes.length ? decode(bytes) : null;
      value =
        text !== undefined && (!sub || text.length > 1)
          ? text
          : sub
            ? toJson(bytes, depth + 1)
            : Buffer.from(bytes).toString("base64");
    } else value = Buffer.from(v as Uint8Array).toString("hex");
    const k = String(f);
    out[k] = k in out ? [...(Array.isArray(out[k]) ? (out[k] as unknown[]) : [out[k]]), value] : value;
  }
  return out;
}
