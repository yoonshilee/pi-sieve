import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { SCORE_TOOL, ScoreParameters, scoreOptions, type ScoringResult } from "./scoring.ts";
import {
  DEFAULTS, SEARCH_TOOL, QUERY_LIMIT, loadConfig, loadDocuments, renderDocuments, selectCandidates,
  type Config,
} from "./selection.ts";

const AUTH_PROVIDER = "typesafe";
interface Diagnostics {
  reason: ScoringResult["reason"];
  operation?: "search" | "score";
  evaluated?: number;
  selected?: number;
  skipped?: number;
  elapsedMs?: number;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export default function sieve(pi: ExtensionAPI): void {
  // Register authentication only; Jev is not a main-agent chat model.
  pi.registerProvider(AUTH_PROVIDER, { name: "TypeSafe", apiKey: "$TYPESAFE_API_KEY", models: [] });
  let enabledOverride: boolean | undefined;
  let diagnostics: Diagnostics = { reason: "not_run" };
  const requests = new Set<AbortController>();

  function cancelSearches(): void {
    for (const request of requests) request.abort();
    requests.clear();
  }

  function resetSession(): void {
    cancelSearches();
    enabledOverride = undefined;
    diagnostics = { reason: "not_run" };
  }

  pi.on("session_start", resetSession);
  pi.on("session_shutdown", resetSession);
  pi.on("session_tree", resetSession);
  pi.on("input", cancelSearches);

  pi.registerCommand("sieve", {
    description: "Inspect Sieve or toggle Jev: status, on, off",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action === "off" || action === "on") {
        cancelSearches();
        enabledOverride = action === "on";
        diagnostics = { reason: action === "off" ? "disabled" : "not_run" };
        ctx.ui.notify(action === "on" ? "Sieve will use Jev for scoring and search." : "Sieve scoring is disabled; search uses local matching.", "info");
      } else if (action === "status") {
        let enabled = enabledOverride ?? DEFAULTS.enabled;
        try { enabled = enabledOverride ?? (await loadConfig(ctx.cwd)).enabled; }
        catch { diagnostics = { reason: "invalid_config" }; }
        ctx.ui.notify(JSON.stringify({ enabled, ...diagnostics }), "info");
      } else ctx.ui.notify("Usage: /sieve status|on|off", "warning");
    },
  });

  pi.registerTool({
    name: SCORE_TOOL, label: "Sieve Score",
    description: "Delegate evaluation of candidate actions, references, or plans to Jev. Supply the relevant facts, candidate options, one evaluation question, and shared descriptive scoring levels from low to high. Returns per-option scores, probabilities, and confidence; you choose what to do next. Does not execute options or authorize actions.",
    promptGuidelines: ["Use sieve_score when comparing several plausible options would require substantial evaluation. Propose grounded candidates and a shared rubric without first completing the same evaluation yourself. Include only the necessary facts: every supplied field is sent to TypeSafe. Read the returned scores as judgments, not guaranteed correctness; you retain the final decision. If scoring is unavailable, reason directly. Do not request scores for facts code can determine exactly."],
    parameters: ScoreParameters,
    async execute(_id, input, signal, _update, ctx) {
      const request = new AbortController();
      requests.add(request);
      const combined = AbortSignal.any([request.signal, ...(signal ? [signal] : []), ...(ctx.signal ? [ctx.signal] : [])]);
      const unavailable = (reason: ScoringResult["reason"]) => ({ available: false, reason, results: [] });
      const reply = (result: object) => ({ content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result });
      try {
        combined.throwIfAborted();
        if (!ctx.isProjectTrusted()) { diagnostics = { operation: "score", reason: "untrusted_project" }; return reply(unavailable("untrusted_project")); }
        let config: Config;
        try { config = await loadConfig(ctx.cwd); }
        catch { combined.throwIfAborted(); diagnostics = { operation: "score", reason: "invalid_config" }; return reply(unavailable("invalid_config")); }
        config.enabled = enabledOverride ?? config.enabled;
        let key: string | undefined;
        if (config.enabled) {
          try { key = await ctx.modelRegistry.getApiKeyForProvider(AUTH_PROVIDER); }
          catch { /* Missing credentials return no fabricated scores. */ }
        }
        combined.throwIfAborted();
        const result = await scoreOptions(input, config, key, combined);
        combined.throwIfAborted();
        diagnostics = { operation: "score", reason: result.reason, evaluated: result.evaluated,
          elapsedMs: result.elapsedMs, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
        return reply(result);
      } catch {
        return reply(unavailable(combined.aborted ? "cancelled" : "service_error"));
      } finally { requests.delete(request); }
    },
  });

  pi.registerTool({
    name: SEARCH_TOOL, label: "Sieve Search",
    description: "Search project memories and command guides for a specific information need. Returns selected references and their source paths. Does not execute commands or change available skills and tools.",
    promptGuidelines: ["Use sieve_search when project memories or command guides may help. Supply a concise information need, not conversation history or raw tool output. The query and candidate summaries may be sent to TypeSafe."],
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: QUERY_LIMIT }) }),
    async execute(_id, { query }, signal, _update, ctx) {
      const started = performance.now();
      const request = new AbortController();
      requests.add(request);
      const combined = AbortSignal.any([request.signal, ...(signal ? [signal] : []), ...(ctx.signal ? [ctx.signal] : [])]);
      const reply = (details: Diagnostics, references = "") => ({
        content: [{ type: "text" as const, text: `Sieve retrieval: ${details.reason}.\n${references || "No reference content returned."}` }], details,
      });
      try {
        combined.throwIfAborted();
        if (!ctx.isProjectTrusted()) { diagnostics = { reason: "untrusted_project" }; return reply(diagnostics); }
        let config: Config;
        try { config = await loadConfig(ctx.cwd); }
        catch { combined.throwIfAborted(); diagnostics = { reason: "invalid_config" }; return reply(diagnostics); }
        config.enabled = enabledOverride ?? config.enabled;
        combined.throwIfAborted();
        const loaded = await loadDocuments(ctx.cwd, config);
        combined.throwIfAborted();
        let key: string | undefined;
        if (config.enabled) {
          try { key = await ctx.modelRegistry.getApiKeyForProvider(AUTH_PROVIDER); }
          catch { /* Credential failures use the same bounded local fallback as a missing key. */ }
        }
        combined.throwIfAborted();
        const selection = await selectCandidates(query, loaded.candidates, config, key, combined);
        combined.throwIfAborted();
        diagnostics = {
          operation: "search", reason: selection.fallback, evaluated: selection.evaluated, selected: selection.documents.length,
          skipped: loaded.skipped, elapsedMs: Math.round(performance.now() - started), model: selection.model,
          inputTokens: selection.inputTokens, outputTokens: selection.outputTokens,
        };
        return reply(diagnostics, renderDocuments(selection.documents, config.contextChars));
      } catch {
        // Do not publish an obsolete result or overwrite a newer session's diagnostics.
        return reply({ reason: combined.aborted ? "cancelled" : "service_error" });
      } finally { requests.delete(request); }
    },
  });
}
