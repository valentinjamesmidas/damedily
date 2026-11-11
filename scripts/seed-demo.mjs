import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seedFile = resolve(root, "supabase/seed.sql");
const sql = readFileSync(seedFile);

function statusEnv() {
  return execFileSync("supabase", ["status", "-o", "env"], {
    cwd: root,
    encoding: "utf8",
  });
}

let status = "";
try {
  status = statusEnv();
} catch {
  console.error("Lokální Supabase neběží. Nejdřív spusťte `supabase start`.");
  process.exit(1);
}

const dbUrl = status.match(/^DB_URL="([^"]+)"/m)?.[1] ?? status.match(/^DB_URL=(\S+)/m)?.[1];
if (!dbUrl) {
  console.error("V `supabase status` chybí DB_URL.");
  process.exit(1);
}

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}

try {
  run("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", seedFile]);
} catch (error) {
  if (error && error.code !== "ENOENT") throw error;
  run("docker", ["exec", "-i", "supabase_db_damedily", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

console.log("Ukázkový sklad je v databázi. Položky začínají [UKÁZKA].");
