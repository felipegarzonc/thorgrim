// Phone notifications (web push). Each member turns them on from Profile on
// each phone; whatever lands in their Activity (server/notices.ts) is also
// pushed to those phones. The server makes its own keys the first time and
// keeps them in storage (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY override).

import crypto from "node:crypto";
import webpush from "web-push";
import { blobs } from "./blobs.ts";
import { currentUser } from "./context.ts";
import { Collection } from "./store.ts";
import { UserError } from "./errors.ts";

interface Keys {
  publicKey: string;
  privateKey: string;
}
interface Subscription {
  id: string;
  sub: webpush.PushSubscription;
  at: string;
}

const KEYS = "settings/push-keys.json";
const SUBJECT = process.env.VAPID_SUBJECT ?? "https://github.com/felipegarzonc/thorgrim";
const subsIn = (prefix: string) => new Collection<Subscription>("push", prefix);
let keys: Keys | null = null;

async function vapid(): Promise<Keys> {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  else {
    const saved = await blobs().read(KEYS);
    if (saved) keys = JSON.parse(saved.toString("utf8")) as Keys;
    else {
      await blobs().write(KEYS, JSON.stringify(webpush.generateVAPIDKeys()), "application/json");
      // Read back: if two servers made keys at once, everyone uses the one that was kept.
      keys = JSON.parse((await blobs().read(KEYS))!.toString("utf8")) as Keys;
    }
  }
  return keys!;
}

export const publicKey = async () => (await vapid()).publicKey;

const idOf = (endpoint: string) => crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 24);

// The browsers' push services. The server sends to whatever endpoint a phone
// gives, so any other address (an internal service, someone's site) is refused.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];
export function isPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && !u.username && !u.password && PUSH_HOSTS.some((h) => h.test(u.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

/** This phone wants notifications for the signed-in member. */
export async function subscribe(sub: webpush.PushSubscription) {
  if (!isPushEndpoint(sub?.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new UserError("That isn't a push subscription.");
  const clean = { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } };
  await subsIn(currentUser().prefix).save({ id: idOf(sub.endpoint), sub: clean, at: new Date().toISOString() });
}

export async function unsubscribe(endpoint: string) {
  if (typeof endpoint === "string") await subsIn(currentUser().prefix).delete(idOf(endpoint));
}

/** Send to every phone a member turned notifications on for. Phones that went away are forgotten. */
export async function pushTo(prefix: string, payload: { title: string; body: string; href: string; tag?: string }) {
  // Subscriptions saved before the endpoint check are skipped too.
  const subs = (await subsIn(prefix).list()).filter((s) => isPushEndpoint(s.sub?.endpoint));
  if (!subs.length) return;
  const { publicKey: pub, privateKey } = await vapid();
  await Promise.all(
    subs.map((s) =>
      webpush
        .sendNotification(s.sub, JSON.stringify(payload), { TTL: 3600, vapidDetails: { subject: SUBJECT, publicKey: pub, privateKey } })
        .catch(async (e: { statusCode?: number }) => {
          if (e.statusCode === 404 || e.statusCode === 410) await subsIn(prefix).delete(s.id);
          else console.error("Push failed:", e);
        }),
    ),
  );
}
