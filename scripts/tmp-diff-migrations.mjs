import fs from "node:fs";

const dir = "supabase/migrations";
const local = new Set(
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && !f.startsWith("_"))
    .map((f) => f.split("_")[0]),
);

const raw = fs.readFileSync("scripts/tmp-migrations-remote.json", "utf8");
const start = raw.indexOf('"rows":');
const arrStart = raw.indexOf("[", start);
let depth = 0;
let arrEnd = arrStart;
for (let i = arrStart; i < raw.length; i++) {
  if (raw[i] === "[") depth++;
  if (raw[i] === "]") {
    depth--;
    if (depth === 0) {
      arrEnd = i + 1;
      break;
    }
  }
}
const rows = JSON.parse(raw.slice(arrStart, arrEnd));
const remote = new Set(rows.map((r) => r.version));

const onlyRemote = [...remote].filter((v) => !local.has(v));
const onlyLocal = [...local].filter((v) => !remote.has(v));

console.log("remote count", remote.size, "local count", local.size);
console.log("onlyRemote", onlyRemote);
console.log("onlyLocal", onlyLocal);
