/** Pass 2 — actor.permissions for helper functions that still use role + preferences. */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "src");

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(tsx?)$/.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

let changed = 0;

for (const file of walk(root)) {
  let src = fs.readFileSync(file, "utf8");
  const orig = src;

  src = src.replace(/canInventoryCount\s*\(\s*actor\.role\s*,\s*([^)]+)\)/g, "canInventoryCount(actor.role, $1, actor.permissions)");
  src = src.replace(
    /canRecordCashExpenses\s*\(\s*actor\.role\s*,\s*([^,)]+)\)/g,
    "canRecordCashExpenses(actor.role, $1, actor.permissions)",
  );
  src = src.replace(
    /canRecordCashExpenses\s*\(\s*actor\.role\s*,\s*state\.preferences\s*\)/g,
    "canRecordCashExpenses(actor.role, state.preferences, actor.permissions)",
  );
  src = src.replace(
    /resolveProfitVisibility\s*\(\s*\{\s*role:\s*actor\.role\s*,\s*snapshot\s*,\s*authMode\s*\}\s*\)/g,
    "resolveProfitVisibility({ role: actor.role, snapshot, authMode, actorPermissions: actor.permissions })",
  );
  src = src.replace(
    /resolveProfitVisibility\s*\(\s*\{\s*role\s*,\s*snapshot\s*,\s*authMode\s*\}\s*\)/g,
    "resolveProfitVisibility({ role, snapshot, authMode, actorPermissions })",
  );

  if (src !== orig) {
    fs.writeFileSync(file, src);
    changed++;
    console.log("updated:", path.relative(path.resolve(import.meta.dirname, ".."), file));
  }
}

console.log(`\nDone. ${changed} files updated.`);
