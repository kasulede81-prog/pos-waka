/**
 * Phase 13.4 — bulk migrate hasPermission(actor.role) → actorHasPermission(actor)
 * and hasEffectivePermission(actor.role, ..., authMode) → actorHasEffectivePermission(...)
 */
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

const skip = new Set([
  path.normalize("src/lib/permissions.ts"),
  path.normalize("src/lib/actorAuthorization.ts"),
  path.normalize("src/lib/subscriptionEntitlements.ts"),
]);

let changed = 0;

for (const file of walk(root)) {
  const rel = path.relative(path.resolve(import.meta.dirname, ".."), file).replace(/\\/g, "/");
  if (skip.has(rel)) continue;

  let src = fs.readFileSync(file, "utf8");
  const orig = src;

  src = src.replace(/hasPermission\s*\(\s*actor\.role\s*,/g, "actorHasPermission(actor,");
  src = src.replace(
    /hasEffectivePermission\s*\(\s*actor\.role\s*,\s*([^,]+)\s*,\s*snapshot\s*,\s*authMode\s*\)/g,
    "actorHasEffectivePermission(actor, $1, snapshot, authMode)",
  );

  if (src === orig) continue;

  const needsActorHas = src.includes("actorHasPermission(");
  const needsActorEffective = src.includes("actorHasEffectivePermission(");

  if (needsActorHas || needsActorEffective) {
    if (!src.includes('from "../lib/actorAuthorization"') && !src.includes('from "../../lib/actorAuthorization"')) {
      const depth = rel.split("/").length - 2;
      const prefix = depth <= 0 ? "./" : "../".repeat(depth);
      const importLine = `import { ${[
        needsActorHas ? "actorHasPermission" : null,
        needsActorEffective ? "actorHasEffectivePermission" : null,
      ]
        .filter(Boolean)
        .join(", ")} } from "${prefix}lib/actorAuthorization";\n`;

      const importMatch = src.match(/^import .+;\n/m);
      if (importMatch) {
        const idx = src.indexOf(importMatch[0]) + importMatch[0].length;
        src = src.slice(0, idx) + importLine + src.slice(idx);
      } else {
        src = importLine + src;
      }
    }

    if (src.includes("actorHasPermission(") && src.includes('from "../lib/permissions"')) {
      const stillUsesHasPermission = /\bhasPermission\s*\(/.test(src);
      if (!stillUsesHasPermission) {
        src = src.replace(/import\s*\{([^}]*)\}\s*from\s*["']\.\.\/lib\/permissions["'];?\n/g, (_, inner) => {
          const parts = inner.split(",").map((s) => s.trim()).filter(Boolean);
          const kept = parts.filter((p) => p !== "hasPermission");
          if (kept.length === 0) return "";
          return `import { ${kept.join(", ")} } from "../lib/permissions";\n`;
        });
        src = src.replace(/import\s*\{([^}]*)\}\s*from\s*["']\.\.\/\.\.\/lib\/permissions["'];?\n/g, (_, inner) => {
          const parts = inner.split(",").map((s) => s.trim()).filter(Boolean);
          const kept = parts.filter((p) => p !== "hasPermission");
          if (kept.length === 0) return "";
          return `import { ${kept.join(", ")} } from "../../lib/permissions";\n`;
        });
      }
    }

    if (src.includes("actorHasEffectivePermission(") && /\bhasEffectivePermission\b/.test(src)) {
      // keep subscriptionEntitlements import if still used
    } else if (src.includes("actorHasEffectivePermission(")) {
      src = src.replace(
        /import\s*\{([^}]*)\}\s*from\s*["']\.\.\/lib\/subscriptionEntitlements["'];?\n/g,
        (_, inner) => {
          const parts = inner.split(",").map((s) => s.trim()).filter(Boolean);
          const kept = parts.filter((p) => p !== "hasEffectivePermission");
          if (kept.length === 0) return "";
          return `import { ${kept.join(", ")} } from "../lib/subscriptionEntitlements";\n`;
        },
      );
    }
  }

  fs.writeFileSync(file, src);
  changed++;
  console.log("updated:", rel);
}

console.log(`\nDone. ${changed} files updated.`);
