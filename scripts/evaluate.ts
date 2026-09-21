import { readFile } from "node:fs/promises";
import { DEFAULTS, keywordScore, rankCandidates, renderDocuments, selectCandidates, type Candidate } from "../src/selection.ts";

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
  const keyword = rankCandidates(sample.task, fixture.candidates).filter((item) => keywordScore(sample.task, item) > 0);
  const keywordMs = performance.now() - started;
  const selection = live ? await selectCandidates([sample.task], fixture.candidates, { ...DEFAULTS }) : undefined;
  const choices = [
    { mode: "all", items: fixture.candidates, elapsedMs: 0 },
    { mode: "keyword", items: keyword, elapsedMs: keywordMs },
    ...(selection ? [{ mode: "jev", items: [...selection.documents, ...fixture.candidates.filter((item) =>
      (item.kind === "skill" || item.kind === "tool") && !selection.excluded.has(item.id))], elapsedMs: selection.elapsedMs }] : []),
  ];
  for (const choice of choices) {
    const ids = new Set(choice.items.map((item) => item.id));
    const found = sample.required.filter((id) => ids.has(id)).length;
    const documents = choice.items.filter((item) => item.body !== undefined);
    const context = renderDocuments(documents, choice.mode === "all" ? Number.MAX_SAFE_INTEGER : DEFAULTS.contextChars) +
      JSON.stringify(choice.items.filter((item) => item.kind === "skill" || item.kind === "tool").map(({ name, description }) => ({ name, description })));
    rows.push({ case: sample.id, mode: choice.mode, selected: ids.size,
      requiredRecall: sample.required.length ? found / sample.required.length : null,
      contextChars: context.length, selectionMs: Math.round(choice.elapsedMs * 100) / 100,
      ...(choice.mode === "jev" ? { fallback: selection!.fallback, model: selection!.model, inputTokens: selection!.inputTokens } : {}),
      taskOutcome: "not_run", endToEndMs: null,
    });
  }
}
console.log(JSON.stringify({
  note: "Synthetic selection benchmark only. Main-agent outcomes and end-to-end latency require separate task execution. Character counts are not token counts.",
  jev: live ? "live" : "not_run: use --live with TYPESAFE_API_KEY", rows,
}, null, 2));
