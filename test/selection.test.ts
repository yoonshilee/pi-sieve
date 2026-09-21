import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULTS, isMentioned, loadConfig, loadDocuments, parseConfig, renderDocuments, selectCandidates,
  type Candidate,
} from "../src/selection.ts";

const candidates: Candidate[] = [
  { id: "memory:one", kind: "memory", name: "payments", description: "Payment retry behavior", body: "PRIVATE_BODY", path: "/fictional/workspace/memory.md" },
  { id: "tool:payments", kind: "tool", name: "payment_lookup", description: "Look up a payment" },
  { id: "tool:weather", kind: "tool", name: "weather", description: "Look up weather" },
  { id: "skill:report", kind: "skill", name: "report", description: "Write reports", pinned: true },
];

test("selection and outbound privacy", async (t) => {
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "fixture-only";
  t.after(() => { if (previous === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previous; });
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const body = String(options.body);
    requests.push(body);
    const request = JSON.parse(body);
    const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
      const value = question as { instructions: { candidate?: { name: string } } };
      return [id, { type: "noul", noul: value.instructions.candidate?.name === "weather" ? 0.1 : 0.9 }];
    }));
    return Response.json({ model: DEFAULTS.model, answers, usage: { input_tokens: 100 } });
  });
  const result = await selectCandidates(["Fix payment retries"], candidates, { ...DEFAULTS });
  assert.equal(result.fallback, "none");
  assert.deepEqual([...result.excluded], ["tool:weather"]);
  assert.equal(result.documents[0].name, "payments");
  assert.equal(result.inputTokens, 100);
  assert.equal(requests.length, 1);
  assert(!requests[0].includes("PRIVATE_BODY"));
  assert(!requests[0].includes("/fictional/"));
  assert(!requests[0].includes("fixture-only"));
  assert(!requests[0].includes('"name":"report"'));
  const limited = await selectCandidates(["payment"], candidates, { ...DEFAULTS, maxCandidates: 1 });
  assert.equal(limited.excluded.size, 0, "Unjudged tools must stay available");
  assert(isMentioned("Please use /skill:report", "report"));
  assert(!isMentioned("reporting", "report"));
});

test("missing credentials, invalid answers, service errors, timeouts, and cancellation preserve tools", async (t) => {
  const previous = process.env.TYPESAFE_API_KEY;
  t.after(() => { if (previous === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previous; });
  delete process.env.TYPESAFE_API_KEY;
  const missing = await selectCandidates(["payment"], candidates, { ...DEFAULTS });
  assert.equal(missing.fallback, "missing_key");
  assert.equal(missing.documents.length, 1);
  process.env.TYPESAFE_API_KEY = "fixture-only";
  for (const response of [
    Response.json({ model: DEFAULTS.model, answers: {} }),
    new Response("PRIVATE_ERROR_BODY", { status: 429 }),
    new Response("malformed"),
    new Response("x".repeat(70_000)),
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    const selection = await selectCandidates(["payment"], candidates, { ...DEFAULTS });
    assert(selection.fallback !== "none");
    assert.equal(selection.excluded.size, 0);
    assert(!JSON.stringify(selection).includes("PRIVATE_ERROR_BODY"));
    mock.mock.restore();
  }
  const mock = t.mock.method(globalThis, "fetch", (_url: unknown, options: RequestInit) => new Promise((_resolve, reject) => {
    if (options.signal?.aborted) reject(new Error("PRIVATE_NETWORK_ERROR"));
    options.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_NETWORK_ERROR")), { once: true });
  }));
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const timed = await selectCandidates(["payment"], candidates, { ...DEFAULTS, timeoutMs: 10 });
    assert.equal(timed.fallback, "timeout");
    assert.equal(timed.excluded.size, 0);
    const cancelled = await selectCandidates(["payment"], candidates, { ...DEFAULTS }, AbortSignal.abort());
    assert.equal(cancelled.fallback, "cancelled");
  } finally { clearTimeout(keepAlive); mock.mock.restore(); }
  const input = await selectCandidates(["x".repeat(8001)], candidates, { ...DEFAULTS });
  assert.equal(input.fallback, "input_too_large");
});

test("configuration, document boundaries, and complete-body budget", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sieve-documents-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".pi/sieve/memories"), { recursive: true });
  await writeFile(join(cwd, ".pi/sieve/memories/payment.md"), "---\nname: payments\ndescription: Payment retry behavior\n---\nRead the test output first.");
  await writeFile(join(cwd, ".pi/sieve/memories/no-summary.md"), "Body must never become a summary.");
  await writeFile(join(cwd, "outside.md"), "---\nname: outside\ndescription: Hidden input\n---\nOutside body");
  await symlink(join(cwd, "outside.md"), join(cwd, ".pi/sieve/memories/link.md"));
  const config = await loadConfig(cwd);
  const loaded = await loadDocuments(cwd, config);
  assert.equal(loaded.candidates.length, 1);
  assert.equal(loaded.skipped, 2);
  assert.equal(loaded.candidates[0].description, "Payment retry behavior");
  assert(renderDocuments(loaded.candidates, 8000).includes("Read the test output first."));
  const large = [{ ...loaded.candidates[0], body: "x".repeat(9000) }];
  const rendered = renderDocuments(large, 800);
  assert(rendered.length <= 800);
  assert(rendered.includes("Read the source"));
  assert(!rendered.includes("x".repeat(50)), "Do not inject a partial command or instruction");
  for (const value of [null, { apiKey: "forbidden" }, { timeoutMs: 0 }, { maxCandidates: 0.5 }, { includeThreshold: 2 }, { memoryDirs: [1] }, { constructor: 1 }]) {
    assert.throws(() => parseConfig(value), /Invalid Sieve configuration/);
  }
  await writeFile(join(cwd, ".pi/sieve.json"), "invalid PRIVATE_CONFIG");
  await assert.rejects(loadConfig(cwd), { message: "Invalid Sieve configuration." });
});
