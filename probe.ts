import "./src/env.js";
import { scoutTrends } from "./src/fashion.js";

async function main() {
  const result = await scoutTrends("streetwear and runway trends", {
    headless: true,
    target: 2,
    maxSteps: 8,
  });
  console.log(`\n── captured ${result.captures.length} in ${result.steps} steps → ${result.runDir}`);
}
main();
