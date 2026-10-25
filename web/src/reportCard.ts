// The picture a shared battle report shows in WhatsApp and the like
// (1200x630): its title, both armies with their crests, the score, the result,
// the battleplan and its highlights. Drawn here in the sharer's language and
// kept with the club post (server/feed.ts), drawn again when the post changes.

import { translate } from "../../shared/i18n/index.ts";
import { allianceOf, baseFaction } from "../../shared/season.ts";
import type { FeedPostView } from "../../shared/types.ts";
import { currentLang } from "./i18n.ts";
import { ARMY, armyColor } from "./ui.tsx";

const W = 1200;
const H = 630;
export const C = { bg: "#0f1115", panel: "#191c22", line: "#5a4a26", lineSoft: "#2e2716", brass: "#d9ae55", text: "#ece6da", muted: "#a8a396", win: "#9cbf5e", loss: "#e08a4a" };
export const DISPLAY = '"Cinzel", Georgia, serif';
export const SANS = '"Inter", system-ui, sans-serif';
export const SEAL = [
  "M6 12.5a6 6 0 0 1 12 0v1.5H6z",
  "M6.2 11.5C4 10.8 2.8 8.3 3.4 5.3c.9 1.8 2.3 2.8 3.9 3.2",
  "M17.8 11.5c2.2-.7 3.4-3.2 2.8-6.2-.9 1.8-2.3 2.8-3.9 3.2",
  "M12 6.5v7.5",
  "M8 14c0 3 1.6 5.6 4 7 2.4-1.4 4-4 4-7",
  "M10 15.5l2 1.5 2-1.5M10.3 18l1.7 1.3 1.7-1.3",
];

type Post = Pick<FeedPostView, "title" | "sides" | "result" | "battleplan" | "points" | "date" | "badges">;

/** A stroked 24x24 icon (SVG path data) at x, y, `size` px wide. */
export function icon(ctx: CanvasRenderingContext2D, paths: string[], x: number, y: number, size: number, color: string, width = 1.4) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of paths) ctx.stroke(new Path2D(d));
  ctx.restore();
}

/** Text that shrinks until it fits `max` px. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, size: number, weight: number, family: string) {
  let s = size;
  do ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > max && --s > 14);
  ctx.fillText(text, x, y);
}

/** Up to `lines` lines of wrapped text, the last ending in … when cut. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max) line = next;
    else {
      out.push(line);
      line = word;
      if (out.length === lines) break;
    }
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines && out.join(" ").length < text.length) out[lines - 1] = `${out[lines - 1].replace(/\s+\S*$/, "")}…`;
  return out;
}

export function crest(ctx: CanvasRenderingContext2D, faction: string, cx: number, cy: number, r: number) {
  const color = armyColor(faction);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  const mark = ARMY[allianceOf(faction) as keyof typeof ARMY]?.mark ?? "M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z";
  icon(ctx, mark.split(/(?=M)/), cx - r * 0.6, cy - r * 0.6, r * 1.2, color, 1.9);
}

/** The card as a JPEG (small enough for WhatsApp's large previews). */
export async function drawReportCard(post: Post): Promise<Blob> {
  const lang = currentLang();
  const t = (s: string) => translate(s, lang);
  await Promise.all([document.fonts.load(`700 60px ${DISPLAY}`), document.fonts.load(`600 30px ${SANS}`), document.fonts.load(`400 24px ${SANS}`)]).catch(() => undefined);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Ground, a warm glow and the double brass frame.
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 330, 40, W / 2, 330, 520);
  glow.addColorStop(0, "rgba(217,174,85,0.12)");
  glow.addColorStop(1, "rgba(217,174,85,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.roundRect(24, 24, W - 48, H - 48, 18);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = C.lineSoft;
  ctx.beginPath();
  ctx.roundRect(36, 36, W - 72, H - 72, 12);
  ctx.stroke();

  // Top: Thorgrim and the kind of post; the battleplan on the right.
  icon(ctx, SEAL, 62, 52, 42, C.brass);
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.brass;
  ctx.textAlign = "left";
  ctx.font = `700 22px ${DISPLAY}`;
  ctx.fillText(`THORGRIM · ${t("Battle report").toUpperCase()}`, 116, 74);
  ctx.textAlign = "right";
  ctx.fillStyle = C.muted;
  ctx.font = `400 22px ${SANS}`;
  ctx.fillText([post.battleplan, post.points && `${post.points} pts`].filter(Boolean).join(" · "), W - 64, 74);

  // The title.
  ctx.textAlign = "center";
  ctx.fillStyle = C.text;
  ctx.font = `700 46px ${DISPLAY}`;
  const title = wrap(ctx, post.title || t("Battle report"), W - 180, 2);
  title.forEach((line, i) => ctx.fillText(line, W / 2, 160 + i * 56 - (title.length - 1) * 28));

  // The armies and the score.
  const [a, b] = post.sides;
  const row = 340;
  if (a && b) {
    for (const [side, x, align] of [
      [a, 230, "center"],
      [b, W - 230, "center"],
    ] as const) {
      crest(ctx, side.faction, x, row - 30, 44);
      ctx.textAlign = align;
      ctx.fillStyle = C.text;
      fitText(ctx, side.name, x, row + 46, 330, 34, 600, SANS);
      ctx.fillStyle = C.muted;
      fitText(ctx, side.faction ? baseFaction(side.faction) : "", x, row + 84, 330, 22, 400, SANS);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = C.text;
    ctx.font = `700 112px ${DISPLAY}`;
    ctx.fillText(`${a.vp}–${b.vp}`, W / 2, row - 10);
    const label = post.result === "win" ? "VICTORY" : post.result === "loss" ? "DEFEAT" : post.result === "draw" ? "DRAW" : "";
    if (label) {
      ctx.fillStyle = post.result === "loss" ? C.loss : C.brass;
      ctx.font = `700 30px ${DISPLAY}`;
      ctx.fillText(`${t(label)} · ${a.name}`, W / 2, row + 72);
    }
  }

  // Highlights, as pills.
  const badges = post.badges.slice(0, 3).map(t);
  if (badges.length) {
    ctx.font = `600 22px ${SANS}`;
    const widths = badges.map((x) => Math.min(ctx.measureText(x).width + 40, 340));
    const total = widths.reduce((s, w) => s + w, 0) + (badges.length - 1) * 14;
    let x = (W - total) / 2;
    badges.forEach((text, i) => {
      ctx.fillStyle = "#2a2418";
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, 478, widths[i], 44, 22);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = C.brass;
      ctx.textAlign = "center";
      fitText(ctx, text, x + widths[i] / 2, 500, widths[i] - 28, 22, 600, SANS);
      x += widths[i] + 14;
    });
  }

  // Bottom: where it comes from.
  ctx.textAlign = "center";
  ctx.fillStyle = C.muted;
  ctx.font = `400 20px ${SANS}`;
  ctx.fillText("thorgrim.co", W / 2, 566);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the image"))), "image/jpeg", 0.88));
}
