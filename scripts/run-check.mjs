import { spawnSync } from "node:child_process";
import path from "node:path";

const xdg = process.env.XDG_CACHE_HOME || path.join(process.cwd(), ".cache");
const cache = path.join(xdg, "npm");
const env = {
  ...process.env,
  npm_config_cache: cache,
  NPM_CONFIG_CACHE: cache,
};
const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: node scripts/run-check.mjs <command> [args...]");
  process.exit(2);
}
const result = spawnSync(cmd, args, { stdio: "inherit", env });
process.exit(result.status ?? 1);
