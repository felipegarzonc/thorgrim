// Runs Thorgrim on a port: on your computer (npm run dev / npm start) and in
// Docker. On Vercel, api/index.mjs uses server/app.ts directly instead.

import app from "./app.ts";
import { resumePendingTranscriptions } from "./transcribe.ts";

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`Thorgrim (AoS Coach) on http://localhost:${port}`);
  void resumePendingTranscriptions();
});
