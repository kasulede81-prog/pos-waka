/** Remove unused hasPermission / hasEffectivePermission imports after Phase 13.4 migration. */
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

function cleanImportLine(line, name) {
  const re = new RegExp(`\\b${name}\\b`);
  if (!re.test(line)) return line;
  const parts = line
    .replace(/^import\s*\{/, "")
    .replace(/\}\s*from\s*.+;?\s*$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => p !== name);
  if (parts.length === 0) return null;
  const from = line.match(/from\s+([^;]+)/)?.[1] ?? '""';
  return `import { ${parts.join(", ")} } from ${from};`;
}

let changed = 0;

for (const file of walk(root)) {
  let src = fs.readFileSync(file, "utf8");
  const orig = src;
  const usesHasPermission = /\bhasPermission\s*\(/.test(src);
  const usesHasEffective = /\bhasEffectivePermission\s*\(/.test(src);

  if (!usesHasPermission || !/import[^;]*hasPermission/.test(src)) {
    // ok
  } else if (!usesHasPermission) {
    // handled below
  }

  const lines = src.split("\n");
  const next = lines
    .map((line) => {
      if (!line.includes("import") || !line.includes("from")) return line;
      let out = line;
      if (!usesHasPermission && line.includes("hasPermission")) {
        out = cleanImportLine(line, "hasPermission") ?? "";
      }
      if (!usesHasEffective && out.includes("hasEffectivePermission")) {
        out = cleanImportLine(out, "hasEffectivePermission") ?? "";
      }
      return out;
    })
    .filter((line, i, arr) => line !== "" || (i > 0 && arr[i - 1] !== ""));

  src = next.join("\n");
  if (src !== orig) {
    fs.writeFileSync(file, src);
    changed++;
    console.log("cleaned:", path.relative(path.resolve(import.meta.dirname, ".."), file));
  }
}

console.log(`Done. ${changed} files cleaned.`);
