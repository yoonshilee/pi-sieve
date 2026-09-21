import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULTS, isMentioned, loadConfig, loadDocuments, localSelection, parseConfig, renderDocuments, selectCandidates,
  type Candidate, type JevRequest,
} from "../src/selection.ts";

const candidates: Candidate[] = [
  { id: "memory:one", kind: "memory", name: "payment-history", description: "Payment retry behavior", body: "PRIVATE_BODY", path: "/fictional/workspace/memory.md" },
  { id: "guide:one", kind: "guide", name: "payment-tests", description: "Payment regression checks", body: "PRIVATE_GUIDE", path: "/fictional/workspace/guide.md" },
  { id: "memory:weather", kind: "memory", name: "weather", description: "Weather forecast", body: "PRIVATE_WEATHER", path: "/fictional/workspace/weather.md" },
];

test("one batch judges summaries only; local and Jev use the same query and candidates", async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    requests.push(String(options.body));
    const request: JevRequest = JSON.parse(String(options.body));
    assert.deepEqual(request.state, { query: "payment retry" });
    assert(!Object.hasOwn(request.questions, "task_context"));
    return Response.json({ model: DEFAULTS.model, usage: { input_tokens: 100, output_tokens: 12 },
      answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) =>
        [id, { type: "noul", noul: question.instructions.candidate.name === "weather" ? 0.1 : 0.9 }])) });
  });
  const query = "payment retry";
  const result = await selectCandidates(query, candidates, { ...DEFAULTS }, "fixture-only");
  const local = await selectCandidates(query, candidates, { ...DEFAULTS, enabled: false }, "fixture-only");
  assert.equal(result.fallback, "none");
  assert.equal(local.fallback, "disabled");
  assert.deepEqual(result.documents, local.documents);
  assert.equal(result.evaluated, 3);
  assert.equal(result.inputTokens, 100);
  assert.equal(result.outputTokens, 12);
  assert.equal(local.inputTokens, null);
  assert.equal(requests.length, 1);
  for (const privateText of ["PRIVATE_BODY", "PRIVATE_GUIDE", "/fictional/", "fixture-only"])
    assert(!requests[0].includes(privateText));
});

test("exact names survive negative judgments and obey count and size limits", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    calls++;
    const request: JevRequest = JSON.parse(String(options.body));
    assert.equal(Object.keys(request.questions).length, 1);
    assert(!JSON.stringify(request).includes('"name":"weather"'));
    return Response.json({ model: DEFAULTS.model, answers: { q0: { type: "noul", noul: 0.01 } } });
  });
  const config = { ...DEFAULTS, maxCandidates: 1, maxDocuments: 1 };
  const result = await selectCandidates("weather payment", candidates, config, "fixture-only");
  assert.deepEqual(result.documents.map((item) => item.name), ["weather"]);
  assert.equal(calls, 1);
  assert(isMentioned("Read payment-tests.", "payment-tests"));
  assert(!isMentioned("weathering", "weather"));
  assert(!isMentioned("payment-tests-extra", "payment-tests"));
  assert.deepEqual(localSelection("weather payment", candidates, config, "disabled").documents, result.documents);
});

test("invalid probabilities, missing fields, service errors, and oversized replies fall back safely", async (t) => {
  for (const response of [
    Response.json({ model: DEFAULTS.model, answers: {} }),
    ...[-0.1, 1.1, "0.9", null].map((noul) => Response.json({ model: DEFAULTS.model, answers: { q0: { type: "noul", noul } } })),
    Response.json({ model: DEFAULTS.model, answers: { q0: { type: "choice", noul: 0.9 } } }),
    new Response("PRIVATE_ERROR_BODY", { status: 429 }),
    new Response("malformed"),
    new Response("x".repeat(70_000)),
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    const selection = await selectCandidates("payment", candidates, { ...DEFAULTS, maxCandidates: 1 }, "fixture-only");
    assert.notEqual(selection.fallback, "none");
    assert.equal(selection.documents.length, 2);
    assert.equal(selection.inputTokens, null);
    assert(!JSON.stringify(selection).includes("PRIVATE_ERROR_BODY"));
    mock.mock.restore();
  }
});

test("missing credentials, empty queries, timeout, and cancellation have explicit outcomes", async (t) => {
  assert.equal((await selectCandidates("payment", candidates, { ...DEFAULTS }, undefined)).fallback, "missing_key");
  assert.equal((await selectCandidates("  ", candidates, { ...DEFAULTS }, "fixture-only")).fallback, "empty_query");
  assert.equal((await selectCandidates("x".repeat(8001), candidates, { ...DEFAULTS }, "fixture-only")).fallback, "input_too_large");
  t.mock.method(globalThis, "fetch", (_url: unknown, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_NETWORK_ERROR")), { once: true });
  }));
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const timed = await selectCandidates("payment", candidates, { ...DEFAULTS, timeoutMs: 10 }, "fixture-only");
    assert.equal(timed.fallback, "timeout");
    assert.equal(timed.documents.length, 2);
    const cancelled = await selectCandidates("payment", candidates, { ...DEFAULTS }, "fixture-only", AbortSignal.abort());
    assert.equal(cancelled.fallback, "cancelled");
    assert.deepEqual(cancelled.documents, []);
  } finally { clearTimeout(keepAlive); }
});

test("configuration migration, document boundaries, and complete-body budget", async (t) => {
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
  const rendered = renderDocuments([{ ...loaded.candidates[0], body: "x".repeat(9000) }], 800);
  assert(rendered.length <= 800);
  assert(rendered.includes("Read the source"));
  assert(!rendered.includes("x".repeat(50)), "Never return a partial command or instruction");
  assert.deepEqual(parseConfig({ pinnedSkills: ["review"], pinnedTools: ["weather"], excludeThreshold: 0.8 }), DEFAULTS);
  for (const value of [null, { apiKey: "forbidden" }, { timeoutMs: 0 }, { maxCandidates: 0.5 }, { includeThreshold: 2 }, { memoryDirs: [1] }, { constructor: 1 }, { pinnedSkills: 1 }, { excludeThreshold: 2 }])
    assert.throws(() => parseConfig(value), /Invalid Sieve configuration/);
  await writeFile(join(cwd, ".pi/sieve.json"), "invalid PRIVATE_CONFIG");
  await assert.rejects(loadConfig(cwd), { message: "Invalid Sieve configuration." });
});

test("a late response after cancellation cannot return references", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const request: JevRequest = JSON.parse(String(options.body));
    controller.abort();
    return Response.json({ model: DEFAULTS.model,
      answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, { type: "noul", noul: 0.99 }])) });
  });
  const result = await selectCandidates("payment", candidates, { ...DEFAULTS }, "fixture-only", controller.signal);
  assert.equal(result.fallback, "cancelled");
  assert.deepEqual(result.documents, []);
});
