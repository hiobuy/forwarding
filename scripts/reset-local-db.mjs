import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localDb = path.join(root, ".wrangler", "state", "v3", "d1");

await rm(localDb, { recursive: true, force: true });

const child = spawn("npm", ["run", "db:migrate"], { cwd: root, stdio: "inherit", shell: true });
const code = await new Promise((resolve) => child.on("exit", resolve));
if (code !== 0) process.exit(code ?? 1);
console.log("Local database cleared and migrations applied.");
