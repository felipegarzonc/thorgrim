// Links people share (invites, games, battle reports). Each goes through a
// small page with its own preview in WhatsApp and the like (web/public/join.html
// and friends), in the sharer's language, which then opens the app.

import { translate } from "../../shared/i18n/core.ts";
import { currentLang } from "./i18n.ts";

export function shareUrl(kind: "join" | "play" | "r", token: string): string {
  return `${window.location.origin}/${currentLang() === "es" ? "es/" : ""}${kind}/${token}`;
}

/** A message with the link once, in the app's language (share sheets add the link again when given both). */
export const shareText = (message: string, url: string) => `${translate(message, currentLang())} ${url}`;
