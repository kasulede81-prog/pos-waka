import fs from "fs";
const p = "src/lib/posKeyboardShortcuts.ts";
const s = fs.readFileSync(p, "utf8");
const idx = s.indexOf("Enter");
console.log([...s.slice(idx, idx + 25)].map((c) => c.charCodeAt(0)));
