const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const REQUEST_LIMIT = 64_000;
const RESPONSE_LIMIT = 65_536;
const MODEL_PATTERN = /^jev-[a-zA-Z0-9.-]{1,80}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export const tokenCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

type Failure = "request_too_large" | "timeout" | "cancelled" | "service_error" | "invalid_response";
type Evaluation = { ok: false; reason: Failure } | {
  ok: true; answers: Record<string, unknown>; model: string;
  inputTokens: number | null; outputTokens: number | null;
};

export async function evaluateJev(
  request: { model: string; state: unknown; questions: Record<string, unknown> },
  key: string, timeoutMs: number, signal?: AbortSignal,
): Promise<Evaluation> {
  if (signal?.aborted) return { ok: false, reason: "cancelled" };
  const body = JSON.stringify(request);
  if (Buffer.byteLength(body) > REQUEST_LIMIT) return { ok: false, reason: "request_too_large" };
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body, signal: combined, redirect: "error",
    });
    if (!response.ok) { await response.body?.cancel(); return { ok: false, reason: "service_error" }; }
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, reason: "invalid_response" };
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      combined.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RESPONSE_LIMIT) { await reader.cancel(); return { ok: false, reason: "invalid_response" }; }
      chunks.push(value);
    }
    combined.throwIfAborted();
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isRecord(result) || !isRecord(result.answers) || typeof result.model !== "string" || !MODEL_PATTERN.test(result.model)) {
      return { ok: false, reason: "invalid_response" };
    }
    const usage = isRecord(result.usage) ? result.usage : {};
    return { ok: true, answers: result.answers, model: result.model,
      inputTokens: tokenCount(usage.input_tokens), outputTokens: tokenCount(usage.output_tokens) };
  } catch (error) {
    return { ok: false, reason: signal?.aborted ? "cancelled" : timeout.aborted ? "timeout" : error instanceof SyntaxError ? "invalid_response" : "service_error" };
  }
}
