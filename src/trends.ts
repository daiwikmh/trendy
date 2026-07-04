import "./env.js";
import { scoutTrends } from "./fashion.js";

const topic = process.argv[2] || "current fashion trends";
const startUrl = process.argv[3];

const result = await scoutTrends(topic, {
  startUrl,
  headless: process.env.HEADLESS === "1",
});

console.log(`\n── captured ${result.captures.length} looks in ${result.steps} steps`);
console.log(`   files + manifest: ${result.runDir}`);
