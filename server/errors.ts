// What a player sees when something fails. Errors thrown as UserError (and
// the sign-in and club errors built on it) carry a message written for the
// player and are shown as they are. Anything else (a storage error naming
// paths, a bug) is logged on the server and the player gets a plain message.

import Anthropic from "@anthropic-ai/sdk";

export class UserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const SERVER_ERROR = "Something went wrong on Thorgrim's side. Try again in a moment.";

/** The status and message to send for an error; `expected` is false for a failure the server should log. */
export function publicError(err: unknown): { status: number; message: string; expected: boolean } {
  if (err instanceof UserError) return { status: err.status, message: err.message, expected: true };
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return { status: 502, message: "Claude rejected the API key. The admin can paste a valid one on the Thorgrim page.", expected: true };
  if (err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503)))
    return { status: 503, message: "Claude is busy right now. Try again in a minute.", expected: true };
  const e = err as { message?: string; status?: number; expose?: boolean };
  if (/authentication method/i.test(e?.message ?? "")) return { status: 503, message: "Thorgrim needs a Claude API key (the admin adds it on the Thorgrim page).", expected: true };
  // Express's own errors for a bad request (broken JSON, too big a body) say so and are safe to show.
  if (e?.expose && typeof e.status === "number" && e.status >= 400 && e.status < 500) return { status: e.status, message: e.message ?? "Bad request", expected: true };
  return { status: 500, message: SERVER_ERROR, expected: false };
}
