import "./src/shared/env.js";
import { scoutTrends } from "./src/fashion/fashion.js";

async function main() {
  const r = await scoutTrends("streetwear looks for summer 2026 for men", {
    headless: true,
    target: 2,
    maxSteps: 22,
    onEvent: (m) => console.log(m),
  });
  console.log(`\n── captured ${r.captures.length} looks → ${r.runDir}`);
  for (const c of r.captures) console.log(`   • [${c.delivered}] ${c.caption}`);
}
main();
