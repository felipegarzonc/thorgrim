// Who is making the current request. Set once per request by the auth
// middleware and read anywhere below it (storage, library, usage) without
// passing it through every call.

import { AsyncLocalStorage } from "node:async_hooks";

export interface UserCtx {
  /** Account id (Supabase user id), "owner" for the app password, "local" on your computer. */
  id: string;
  name: string;
  isAdmin: boolean;
  /** Storage prefix for this user's records: "" for the owner (the original data), "users/<id>/" for everyone else. */
  prefix: string;
  /** Can manage the rules library: signed in with the app password (developers), or the app on your own computer. */
  developer?: boolean;
  /** The language the page is in (server/lang.ts). */
  lang?: "en" | "es";
}

/** On your own computer without accounts: one user who owns everything. */
export const LOCAL_USER: UserCtx = { id: "local", name: "", isAdmin: true, prefix: "", developer: true };

const als = new AsyncLocalStorage<UserCtx>();

export const currentUser = (): UserCtx => als.getStore() ?? LOCAL_USER;
export const runAs = <T>(user: UserCtx, fn: () => T): T => als.run(user, fn);
export const userPrefix = (id: string, owner: boolean) => (owner ? "" : `users/${id}/`);
