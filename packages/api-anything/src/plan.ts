// greenlit fork: a call built and shown, never sent — a host's dry run. The session's values are placeholders
// (`<name>`), so a plan holds nothing secret; derived values (lookups) are not fetched.

import { DEADLINE, within } from "./deadline.js";
import { buildRequest, type FileBodyPlan, fileBodyPlan, unknownArgs } from "./http.js";
import { loadSession, placeholders } from "./session.js";
import type { Request } from "./spec.js";
import { loadSite } from "./store.js";

export interface Plan {
  site: string;
  op: string;
  readOnly: boolean;
  request: Request;
  /** A file or multipart body: what would be read from disk and sent. */
  body?: FileBodyPlan;
}

/** The request `call(site, name, args)` would send, with the session's values masked. Sends nothing. */
export function plan(site: string, name: string, args: Record<string, unknown> = {}): Plan {
  const r = loadSite(site);
  if (!r) throw new Error(`no site "${site}"`);
  const op = r.site.operations.find((o) => o.name === name);
  if (!op) throw new Error(`no operation "${name}" on ${site}`);
  const unknown = unknownArgs(op, args);
  if (unknown) throw new Error(unknown);
  const session = placeholders(loadSession(site));
  const request = within(() => buildRequest(op, args, session), DEADLINE.args);
  const body = fileBodyPlan(op, args, session, request.url);
  return { site, op: name, readOnly: !!op.readOnly, request, ...(body ? { body } : {}) };
}
