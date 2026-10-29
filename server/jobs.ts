// Long coach requests (game plans, turn tips) run as jobs: the request
// returns at once with a job id, the work carries on in the background and
// saves its result, and the page polls for it. A phone that locks its screen
// or drops signal mid-way gets the answer when it checks again.

import { waitUntil } from "@vercel/functions";
import { AuthError } from "./accounts.ts";
import { currentUser, runAs } from "./context.ts";
import { publicError } from "./errors.ts";
import { Collection, newId } from "./store.ts";

export interface Job<T = unknown> {
  id: string;
  kind: string;
  status: "running" | "done" | "failed";
  result?: T;
  error?: string;
  /** HTTP-style status for a failure (402 = coach limit reached). */
  code?: number;
  startedAt: string;
  finishedAt?: string;
}

export const jobs = new Collection<Job>("jobs");

/** Start `work` in the background and return its job. */
export async function startJob<T>(kind: string, work: () => Promise<T>): Promise<Job<T>> {
  const job: Job<T> = { id: newId(), kind, status: "running", startedAt: new Date().toISOString() };
  await jobs.save(job);
  // Tidy up this user's old jobs (results are picked up within minutes).
  const day = Date.now() - 86_400_000;
  for (const old of await jobs.list()) if (Date.parse(old.startedAt) < day) await jobs.delete(old.id);
  const user = currentUser();
  const run = runAs(user, async () => {
    try {
      const result = await work();
      await jobs.save({ ...job, status: "done", result, finishedAt: new Date().toISOString() });
    } catch (e) {
      console.error(`${kind} job failed:`, e);
      // The page shows the job's error: only messages meant for the player (server/errors.ts).
      const { status, message } = publicError(e);
      await jobs.save({ ...job, status: "failed", error: message, code: e instanceof AuthError ? e.status : status, finishedAt: new Date().toISOString() });
    }
  });
  // On Vercel, keep the function alive after the response until the work ends.
  waitUntil(run);
  return job;
}
