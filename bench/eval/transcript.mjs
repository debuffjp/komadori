/** Tokens, turns, cost and tool use out of a stream-json transcript. */
export function parseTranscript(text) {
  const out = { turns: 0, cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: {}, final: "" };
  for (const line of text.split("\n")) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "assistant") for (const c of e.message?.content ?? []) if (c.type === "tool_use") out.tools[c.name] = (out.tools[c.name] ?? 0) + 1;
    if (e.type === "result") {
      out.turns = e.num_turns ?? 0;
      out.cost = e.total_cost_usd ?? 0;
      out.final = e.result ?? "";
      const u = e.usage ?? {};
      out.tokens = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
    }
  }
  return out;
}
