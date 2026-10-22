// A stand-in for the Claude API in end-to-end tests: answers every request
// with a streamed message. Structured requests (a JSON schema) get an object
// that fits the schema; the battle report gets a recognisable title.

import http from "node:http";

const PORT = Number(process.env.FAKE_CLAUDE_PORT ?? 8898);

function fill(schema, key = "") {
  if (!schema || typeof schema !== "object") return null;
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case "object": {
      const out = {};
      for (const k of schema.required ?? Object.keys(schema.properties ?? {})) out[k] = fill(schema.properties?.[k], k);
      return out;
    }
    case "array":
      return schema.items?.type === "string" ? [`Test ${key}`] : [];
    case "integer":
    case "number":
      return 1;
    case "boolean":
      return false;
    default:
      return key === "title" ? "The Saga of the Test Table" : key === "story" ? "Steel met steel.\n\nThe test army won the day." : `Test ${key}`;
  }
}

const sse = (res, events) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
};

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (!req.url?.startsWith("/v1/messages")) return res.writeHead(404).end();
      const r = JSON.parse(body || "{}");
      const schema = r.output_config?.format?.schema;
      const text = schema ? JSON.stringify(fill(schema)) : "Test answer from the coach.";
      const message = { id: "msg_test", type: "message", role: "assistant", model: r.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } };
      if (!r.stream) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ...message, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 20 } }));
      }
      sse(res, [
        ["message_start", { type: "message_start", message }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } }],
        ["message_stop", { type: "message_stop" }],
      ]);
    });
  })
  .listen(PORT, () => console.log(`fake Claude on ${PORT}`));
