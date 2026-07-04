import "./env.js";
import { runApplication } from "./agent.js";

const url = process.argv[2];
if (!url) {
  console.error("usage: npx tsx src/apply.ts <job-posting-url>   (set HEADLESS=1 to hide the browser)");
  process.exit(1);
}

const result = await runApplication(url, {
  headless: process.env.HEADLESS === "1",
  onStep: (s) => {
    const a = s.action;
    const bits = [`step ${s.n}: ${a.action}`];
    if (a.idx != null) bits.push(`[${a.idx}]`);
    if (a.value) bits.push(`= ${JSON.stringify(a.value.slice(0, 50))}`);
    console.log(bits.join(" "));
    if (a.reason) console.log(`         ${a.reason}`);
  },
});

console.log(`\n── ${result.status.toUpperCase()} after ${result.steps.length} steps`);
console.log(`   screenshots + trace: ${result.runDir}`);
if (result.status === "await_human") {
  console.log(`   the browser is left open — review the form and submit yourself.`);
  console.log(`   press Ctrl+C when done.`);
}
