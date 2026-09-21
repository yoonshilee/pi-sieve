import { readFile } from "node:fs/promises";
import { DEFAULTS, localSelection, renderDocuments, selectCandidates, type Candidate } from "../src/selection.ts";

const fixture: { candidates: Candidate[]; cases: { id: string; task: string; required: string[] }[] } =
  JSON.parse(await readFile(new URL("../examples/evaluation.json", import.meta.url), "utf8"));
const live = process.argv.includes("--live");
if (live && !process.env.TYPESAFE_API_KEY) {
  console.error("Live evaluation requires TYPESAFE_API_KEY. No request was sent.");
  process.exit(1);
}
const rows = [];
for (const sample of fixture.cases) {
  const started = performance.now();
  const keyword = localSelection(sample.task, fixture.candidates, { ...DEFAULTS }, "disabled").documents;
  const keywordMs = performance.now() - started;
  const selection = live ? await selectCandidates(sample.task, fixture.candidates, { ...DEFAULTS }, process.env.TYPESAFE_API_KEY) : undefined;
  const choices = [
    { mode: "all", items: fixture.candidates, elapsedMs: 0 },
    { mode: "keyword", items: keyword, elapsedMs: keywordMs },
    ...(selection ? [{ mode: "jev", items: selection.documents, elapsedMs: selection.elapsedMs }] : []),
  ];
  for (const choice of choices) {
    const ids = new Set(choice.items.map((item) => item.id));
    const found = sample.required.filter((id) => ids.has(id)).length;
    const documents = choice.items;
    const context = renderDocuments(documents, choice.mode === "all" ? Number.MAX_SAFE_INTEGER : DEFAULTS.contextChars);
    rows.push({ case: sample.id, mode: choice.mode, selected: ids.size,
      requiredRecall: sample.required.length ? found / sample.required.length : null,
      contextChars: context.length, selectionMs: Math.round(choice.elapsedMs * 100) / 100,
      ...(choice.mode === "jev" ? { fallback: selection!.fallback, model: selection!.model, inputTokens: selection!.inputTokens, outputTokens: selection!.outputTokens } : {}),
      taskOutcome: "not_run", endToEndMs: null,
    });
  }
}
console.log(JSON.stringify({
  note: "Synthetic selection benchmark only. Main-agent outcomes and end-to-end latency require separate task execution. Character counts are not token counts.",
  jev: live ? "live" : "not_run: use --live with TYPESAFE_API_KEY", rows,
}, null, 2));
