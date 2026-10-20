// Vercel entry point: every /api/... request is rewritten here (see
// vercel.json) and handed to the Thorgrim Express app, bundled at build time
// into dist-server/app.mjs by `npm run build:server`.
import app from "../dist-server/app.mjs";

export default function handler(req, res) {
  // The rewrite passes the original path as ?__path=…; restore it for Express.
  const url = new URL(req.url, "http://local");
  const original = url.searchParams.get("__path");
  if (original !== null) {
    url.searchParams.delete("__path");
    req.url = `/api/${original}${url.search}`;
  }
  return app(req, res);
}
