// The result of a game as an image to share (WhatsApp, Instagram…), drawn on
// a canvas in the scoreboard style: names, factions, big score, result, and
// the points per battle round.

import { allianceOf, baseFaction } from "../../shared/season.ts";

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
}

const W = 1080;
const H = 1350;
const C = {
  bg: "#111318",
  card: "#1b1e24",
  cell: "#2f3239",
  text: "#e3e3e8",
  muted: "#a9acb5",
  accent: "#a8c7fa",
  win: "#a6d5a0",
  loss: "#f2a8a0",
};
const ALLIANCE_COLOR: Record<string, string> = { Order: "#2c5a8f", Chaos: "#7a2e2e", Death: "#35574f", Destruction: "#6b5520" };
const FONT = '"Roboto", system-ui, sans-serif';

function font(ctx: CanvasRenderingContext2D, size: number, weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

/** Draw text shrinking it until it fits `max` px. */
function fit(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, size: number, weight = 400) {
  let s = size;
  font(ctx, s, weight);
  while (ctx.measureText(text).width > max && s > 14) font(ctx, --s, weight);
  ctx.fillText(text, x, y);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function badge(ctx: CanvasRenderingContext2D, faction: string, cx: number, cy: number, r: number) {
  const base = baseFaction(faction || "?");
  const initials = base
    .split(/[\s-]+/)
    .filter((w) => /^[A-Z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  ctx.fillStyle = ALLIANCE_COLOR[allianceOf(base) ?? ""] ?? "#3a3d44";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f3eee4";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  font(ctx, r * 0.8, 700);
  ctx.fillText(initials || "?", cx, cy + 2);
  ctx.textBaseline = "alphabetic";
}

export async function drawResult(d: ShareData): Promise<Blob> {
  await Promise.all([document.fonts.load(`400 40px Roboto`), document.fonts.load(`700 40px Roboto`), document.fonts.load(`500 40px Roboto`)]).catch(() => undefined);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // header
  ctx.fillStyle = C.muted;
  ctx.textAlign = "left";
  font(ctx, 30, 500);
  ctx.fillText(d.date, 70, 100);
  ctx.textAlign = "right";
  ctx.fillStyle = C.accent;
  font(ctx, 30, 700);
  ctx.fillText("THORGRIM", W - 70, 100);

  // score card
  ctx.fillStyle = C.card;
  roundRect(ctx, 40, 140, W - 80, 450, 40);
  badge(ctx, d.me.faction, 170, 250, 62);
  badge(ctx, d.opponent.faction, W - 170, 250, 62);
  ctx.textAlign = "center";
  ctx.fillStyle = C.text;
  fit(ctx, `${d.me.vp} - ${d.opponent.vp}`, W / 2, 300, 520, 170, 500);
  ctx.fillStyle = d.status === "VICTORY" ? C.win : d.status === "DEFEAT" ? C.loss : C.text;
  font(ctx, 48, 500);
  ctx.fillText(d.status, W / 2, 380);
  for (const [side, x, align] of [
    [d.me, 80, "left"],
    [d.opponent, W - 80, "right"],
  ] as const) {
    ctx.textAlign = align;
    ctx.fillStyle = C.text;
    fit(ctx, side.name, x, 470, 400, 50, 700);
    ctx.fillStyle = C.text;
    fit(ctx, baseFaction(side.faction || "Unknown faction"), x, 520, 420, 32, 400);
    if (side.sub) {
      ctx.fillStyle = C.muted;
      fit(ctx, side.sub, x, 562, 420, 26, 400);
    }
  }

  // points per round
  let y = 680;
  const cellW = 70;
  const cellsX = W - 80 - 130 - 5 * (cellW + 6);
  ctx.textAlign = "center";
  ctx.fillStyle = C.muted;
  font(ctx, 24, 500);
  for (let r = 0; r < 5; r++) ctx.fillText(`R${r + 1}`, cellsX + r * (cellW + 6) + cellW / 2, y - 18);
  for (const side of [d.me, d.opponent]) {
    ctx.textAlign = "left";
    ctx.fillStyle = C.text;
    fit(ctx, side.name, 80, y + 22, 600, 40, 700);
    y += 48;
    for (const row of side.rows.slice(0, 3)) {
      ctx.textAlign = "left";
      ctx.fillStyle = C.text;
      fit(ctx, row.label, 80, y + 38, cellsX - 100, 30, 400);
      row.cells.forEach((v, i) => {
        ctx.fillStyle = C.cell;
        ctx.fillRect(cellsX + i * (cellW + 6), y + 6, cellW, 48);
        ctx.fillStyle = v === null ? C.muted : C.text;
        ctx.textAlign = "center";
        font(ctx, 28, 500);
        ctx.fillText(v === null ? "-" : String(v), cellsX + i * (cellW + 6) + cellW / 2, y + 40);
      });
      ctx.textAlign = "right";
      ctx.fillStyle = C.text;
      font(ctx, 30, 500);
      ctx.fillText(row.total, W - 80, y + 40);
      y += 60;
    }
    y += 34;
  }

  // footer
  ctx.textAlign = "center";
  ctx.fillStyle = C.muted;
  fit(ctx, d.footer, W / 2, H - 70, W - 140, 28, 400);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the image"))), "image/png"));
}

/** Share the image (phone share sheet → WhatsApp…), or download it where sharing files isn't possible. */
export async function shareImage(file: File, text: string): Promise<"shared" | "downloaded"> {
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text });
    return "shared";
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}
