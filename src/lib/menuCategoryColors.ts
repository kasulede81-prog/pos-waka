/** POS-style category accent colors (reference terminal UI). */
export const MENU_CATEGORY_PALETTE = [
  { bg: "bg-amber-100", active: "bg-amber-600", text: "text-amber-950", border: "border-amber-300" },
  { bg: "bg-lime-100", active: "bg-lime-600", text: "text-lime-950", border: "border-lime-300" },
  { bg: "bg-emerald-200", active: "bg-emerald-700", text: "text-emerald-950", border: "border-emerald-400" },
  { bg: "bg-yellow-100", active: "bg-yellow-500", text: "text-yellow-950", border: "border-yellow-300" },
  { bg: "bg-pink-100", active: "bg-pink-500", text: "text-pink-950", border: "border-pink-300" },
  { bg: "bg-orange-100", active: "bg-orange-500", text: "text-orange-950", border: "border-orange-300" },
  { bg: "bg-violet-200", active: "bg-violet-600", text: "text-violet-950", border: "border-violet-400" },
  { bg: "bg-teal-100", active: "bg-teal-600", text: "text-teal-950", border: "border-teal-300" },
  { bg: "bg-sky-100", active: "bg-sky-600", text: "text-sky-950", border: "border-sky-300" },
  { bg: "bg-rose-100", active: "bg-rose-500", text: "text-rose-950", border: "border-rose-300" },
] as const;

export function categoryColorIndex(name: string, index: number): number {
  let hash = index;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) % MENU_CATEGORY_PALETTE.length;
  return hash;
}
