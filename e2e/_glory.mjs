import { chromium } from "@playwright/test";
const D = process.argv[2];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.addInitScript(() => localStorage.setItem("thorgrim-lang", "es"));
p.on("pageerror", (e) => console.log("ERR", e.message));
for (const [name, url] of [["member", "#/club/member/local"], ["ladder", "#/club/ladder"], ["feed", "#/club/reports"], ["wrapped", "#/club/wrapped/local"], ["home", "#/home"]]) {
  await p.goto(`http://localhost:8897/${url}`);
  await p.waitForTimeout(2200);
  await p.screenshot({ path: `${D}/g-${name}.png`, fullPage: true });
}
await b.close();
