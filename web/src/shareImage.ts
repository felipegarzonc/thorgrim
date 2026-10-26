// The result of a game as an image to share (WhatsApp, Instagram…), in
// Thorgrim's war-table look: the brass frame and seal, the report's title,
// both armies with their crests, the big score and result, the highlights,
// then each side's points round by round (objectives and every battle
// tactic). Shared from the game's Results and from its club post.

import { translate } from "../../shared/i18n/core.ts";
import { baseFaction } from "../../shared/season.ts";
import { currentLang } from "./i18n.ts";
import { C, crest, DISPLAY, fitText, icon, SANS, SEAL, wrap } from "./reportCard.ts";
import { armyColor } from "./ui.tsx";

export interface ShareRow {
  label: string;
  cells: (number | null)[];
  total: string;
}
export interface ShareSide {
  name: string;
  faction: string;
  sub: string;
  vp: number;
  rows: ShareRow[];
}
export interface ShareData {
  date: string;
  status: "VICTORY" | "DEFEAT" | "DRAW";
  me: ShareSide;
  opponent: ShareSide;
  footer: string;
  /** The battle report's title, when there is one. */
  title?: string;
  /** Highlights ("Crushing victory for Goy"…), up to three shown. */
  badges?: string[];
}

const W = 1080;
const PAD = 70;
const ROW_H = 62;

function frame(ctx: CanvasRenderingContext2D, h: number) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, h);
  const glow = ctx.createRadialGradient(W / 2, 420, 40, W / 2, 420, 640);
  glow.addColorStop(0, "rgba(217,174,85,0.13)");
  glow.addColorStop(1, "rgba(217,174,85,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, h);
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.roundRect(24, 24, W - 48, h - 48, 22);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = C.lineSoft;
  ctx.beginPath();
  ctx.roundRect(38, 38, W - 76, h - 76, 14);
  ctx.stroke();
}

export async function drawResult(d: ShareData): Promise<Blob> {
  const lang = currentLang();
  const t = (s: string) => translate(s, lang);
  await Promise.all([document.fonts.load(`700 60px ${DISPLAY}`), document.fonts.load(`600 30px ${SANS}`), document.fonts.load(`400 24px ${SANS}`)]).catch(() => undefined);
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `700 50px ${DISPLAY}`;
  const title = d.title ? wrap(measure, d.title, W - 2 * PAD - 40, 2) : [];
  const badges = (d.badges ?? []).slice(0, 3).map(t);
  const sides = [d.me, d.opponent].map((s) => ({ ...s, rows: s.rows.slice(0, 3) }));
  // Height: the header and score, then the sheet's rows.
  const top = 150 + title.length * 60;
  const scoreEnd = top + (d.me.sub || d.opponent.sub ? 300 : 260) + (badges.length ? 76 : 0);
  const sheet = sides.reduce((h, s) => h + 70 + s.rows.length * ROW_H + 26, 70);
  const H = scoreEnd + sheet + 130;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  frame(ctx, H);

  // The seal and Thorgrim, the date on the right.
  icon(ctx, SEAL, 66, 58, 46, C.brass);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = C.brass;
  ctx.font = `700 26px ${DISPLAY}`;
  ctx.fillText(`THORGRIM · ${t("Battle report").toUpperCase()}`, 124, 82);
  ctx.textAlign = "right";
  ctx.fillStyle = C.muted;
  ctx.font = `400 26px ${SANS}`;
  ctx.fillText(d.date, W - PAD, 82);
  ctx.textBaseline = "alphabetic";

  // The report's title.
  ctx.textAlign = "center";
  ctx.fillStyle = C.text;
  ctx.font = `700 50px ${DISPLAY}`;
  title.forEach((line, i) => ctx.fillText(line, W / 2, 178 + i * 60));

  // Armies, score and result.
  const crestY = top + 70;
  for (const [side, x] of [
    [d.me, 200],
    [d.opponent, W - 200],
  ] as const) {
    crest(ctx, side.faction, x, crestY, 62);
    ctx.textAlign = "center";
    ctx.fillStyle = C.text;
    fitText(ctx, side.name, x, crestY + 118, 330, 40, 600, SANS);
    ctx.fillStyle = C.muted;
    fitText(ctx, side.faction ? baseFaction(side.faction) : t("Unknown faction"), x, crestY + 160, 330, 26, 400, SANS);
    if (side.sub) fitText(ctx, side.sub, x, crestY + 196, 330, 22, 400, SANS);
  }
  ctx.textAlign = "center";
  ctx.fillStyle = C.text;
  fitText(ctx, `${d.me.vp}–${d.opponent.vp}`, W / 2, crestY + 40, 400, 130, 700, DISPLAY);
  ctx.fillStyle = d.status === "DEFEAT" ? C.loss : C.brass;
  ctx.font = `700 40px ${DISPLAY}`;
  ctx.fillText(t(d.status), W / 2, crestY + 112);

  // Highlights, as brass pills.
  if (badges.length) {
    ctx.font = `600 24px ${SANS}`;
    const widths = badges.map((x) => Math.min(ctx.measureText(x).width + 44, 310));
    const total = widths.reduce((s, w) => s + w, 0) + (badges.length - 1) * 14;
    let x = (W - total) / 2;
    const y = scoreEnd - 78;
    badges.forEach((text, i) => {
      ctx.fillStyle = "#2a2418";
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, widths[i], 50, 25);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = C.brass;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      fitText(ctx, text, x + widths[i] / 2, y + 26, widths[i] - 28, 24, 600, SANS);
      ctx.textBaseline = "alphabetic";
      x += widths[i] + 14;
    });
  }

  // The score sheet: a panel with each side's rows, round by round.
  const panelX = 56;
  const panelW = W - 112;
  ctx.fillStyle = C.panel;
  ctx.strokeStyle = C.lineSoft;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(panelX, scoreEnd, panelW, sheet, 20);
  ctx.fill();
  ctx.stroke();
  const cellW = 74;
  const gap = 8;
  const totalW = 120;
  const cellsX = panelX + panelW - 34 - totalW - 5 * cellW - 4 * gap;
  let y = scoreEnd + 58;
  ctx.textAlign = "center";
  ctx.fillStyle = C.muted;
  ctx.font = `600 22px ${SANS}`;
  for (let r = 0; r < 5; r++) ctx.fillText(`R${r + 1}`, cellsX + r * (cellW + gap) + cellW / 2, y);
  y += 12;
  for (const side of sides) {
    // The side's name with its army's colour.
    const color = armyColor(side.faction);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(panelX + 34, y + 20, 8, 36, 4);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = C.text;
    fitText(ctx, side.name, panelX + 56, y + 50, cellsX - panelX - 80, 36, 700, DISPLAY);
    y += 70;
    for (const row of side.rows) {
      ctx.textAlign = "left";
      ctx.fillStyle = C.text;
      fitText(ctx, t(row.label), panelX + 34, y + 38, cellsX - panelX - 50, 28, 400, SANS);
      row.cells.forEach((v, i) => {
        const x = cellsX + i * (cellW + gap);
        ctx.fillStyle = v ? "#2a2418" : "#22262d";
        ctx.strokeStyle = v ? C.line : "#2c3037";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x, y + 6, cellW, 48, 10);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = v === null ? "#5d6068" : v ? C.brass : C.muted;
        ctx.textAlign = "center";
        ctx.font = `700 28px ${SANS}`;
        ctx.fillText(v === null ? "–" : String(v), x + cellW / 2, y + 41);
      });
      ctx.textAlign = "right";
      ctx.fillStyle = C.text;
      ctx.font = `700 30px ${SANS}`;
      ctx.fillText(row.total, panelX + panelW - 34, y + 41);
      y += ROW_H;
    }
    y += 26;
  }

  // Footer: the game, and where it comes from.
  ctx.textAlign = "center";
  ctx.fillStyle = C.muted;
  fitText(ctx, d.footer, W / 2, H - 92, W - 2 * PAD - 40, 24, 400, SANS);
  ctx.fillStyle = C.brass;
  ctx.font = `600 24px ${SANS}`;
  ctx.fillText("thorgrim.co", W / 2, H - 56);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the image"))), "image/jpeg", 0.92));
}

/**
 * Share a battle's picture with its text and the link to the full report, in
 * one go (phone share sheet → WhatsApp…: the picture with the link as its
 * caption). Where files can't be shared (most computers) the picture is
 * saved and the link copied. "tap-again": the phone wanted a fresh tap
 * (preparing the link took too long after the first one).
 */
export async function shareImageAndLink(file: File, text: string, url?: string): Promise<"shared" | "saved" | "tap-again"> {
  const caption = url ? `${text}\n${url}` : text;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: caption });
    } catch (e) {
      if ((e as Error).name === "NotAllowedError") return "tap-again";
      // Cancelled: nothing to do.
    }
    return "shared";
  }
  const a = document.createElement("a");
  const href = URL.createObjectURL(file);
  a.href = href;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
  if (url) await navigator.clipboard?.writeText(caption).catch(() => undefined);
  return "saved";
}
