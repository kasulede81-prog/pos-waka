import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, BatteryFull, Bluetooth, Check, Printer, RefreshCw, ScrollText, Usb } from "lucide-react";
import { m, useReducedMotion } from "framer-motion";
import { publicAssetUrl } from "../../../lib/publicAssetUrl";

/**
 * The WP-58 showcase.
 *
 * WHY THE STAGE IS ITS OWN BLACK SURFACE. The printer is matte black with orange
 * accents, and it only reads as a premium object against a dark ground. The stage
 * uses the artwork's own matte black (#1F1F21, from the sheet's colour-palette
 * block) as a literal value rather than a palette class on purpose: this repo
 * remaps `stone-*`/`neutral-*`/`slate-*` onto semantic tokens in
 * `tailwind.config.ts`, so `bg-neutral-950` is near-WHITE in dark mode. A literal
 * hex cannot be caught by that bridge.
 */

const STAGE_BG = "bg-[#141416]";

type Spec = {
  id: string;
  label: string;
  value: string;
  detail: string;
  icon: typeof Bluetooth;
  /** Where the callout sits on the stage, as a percentage of the image box. */
  marker: { left: string; top: string };
};

/**
 * Every figure here is printed on the supplied product sheet. Nothing is
 * inferred, and nothing claims a capability the hardware does not have.
 */
const SPECS: Spec[] = [
  {
    id: "bluetooth",
    label: "Connection",
    value: "Bluetooth",
    detail: "Pairs with the phone or tablet already running DKASU POS. No cables to the till, no network to configure.",
    icon: Bluetooth,
    marker: { left: "62%", top: "30%" },
  },
  {
    id: "paper",
    label: "Paper",
    value: "58mm thermal",
    detail: "Standard 58mm thermal rolls — the size sold in every stationery shop and market stall in Uganda.",
    icon: ScrollText,
    marker: { left: "38%", top: "12%" },
  },
  {
    id: "battery",
    label: "Power",
    value: "2600mAh built-in",
    detail: "Charges over USB-C and keeps printing through a power cut, so a sale is never lost to a blackout.",
    icon: BatteryFull,
    marker: { left: "30%", top: "62%" },
  },
  {
    id: "charging",
    label: "Charging",
    value: "USB-C, DC 5V 2A",
    detail: "The same cable as most Android phones, so a replacement charger is never a hunt.",
    icon: Usb,
    marker: { left: "72%", top: "68%" },
  },
];

export function PrinterShowcase() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<Spec>(SPECS[0]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const heroSrc = publicAssetUrl("brand/waka-printer/wp58-hero.webp");
  const sheetSrc = publicAssetUrl("brand/waka-printer/wp58-sheet.webp");

  /**
   * Pointer tilt. Skipped entirely for reduced motion, and it only ever writes
   * two numbers, so a fast pointer cannot flood React with layout work — the
   * transform is applied by the compositor.
   */
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (reduce || event.pointerType === "touch") return;
      const box = stageRef.current?.getBoundingClientRect();
      if (!box) return;
      const px = (event.clientX - box.left) / box.width - 0.5;
      const py = (event.clientY - box.top) / box.height - 0.5;
      setTilt({ x: -py * 10, y: px * 14 });
    },
    [reduce],
  );

  const resetTilt = useCallback(() => setTilt({ x: 0, y: 0 }), []);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* ---------------------------------------------------------------- stage */}
      <div
        ref={stageRef}
        onPointerMove={onPointerMove}
        onPointerLeave={resetTilt}
        className={`${STAGE_BG} relative overflow-hidden rounded-3xl border border-white/10 p-4 shadow-mkt-lg sm:p-8`}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 12%, rgba(243,111,33,0.30), transparent 70%), radial-gradient(45% 40% at 85% 95%, rgba(243,111,33,0.14), transparent 70%)",
          }}
          aria-hidden="true"
        />

        <div className="relative">
          <m.img
            src={heroSrc}
            alt="Waka POS WP-58 58mm portable thermal printer, angled view"
            width={442}
            height={292}
            loading="eager"
            decoding="async"
            className="mx-auto w-full max-w-[520px] rounded-2xl"
            style={{ transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
            animate={reduce ? undefined : { y: [0, -8, 0] }}
            transition={reduce ? undefined : { duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* The active spec's marker, so the copy below points at the part it describes. */}
          <span
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#F36F21] ring-4 ring-[#F36F21]/25 transition-all duration-300"
            style={{ left: active.marker.left, top: active.marker.top }}
            aria-hidden="true"
          />
        </div>

        <div className="relative mt-6 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white/80">
            Model WP-58
          </span>
          <span className="rounded-full bg-[#F36F21] px-3 py-1.5 text-xs font-bold text-white">
            Included with Business annual
          </span>
        </div>
      </div>

      {/* ---------------------------------------------------------------- specs */}
      <div className="flex min-w-0 flex-col gap-4">
        <div role="tablist" aria-label="Printer specifications" className="flex flex-wrap gap-2">
          {SPECS.map((spec) => {
            const selected = spec.id === active.id;
            const Icon = spec.icon;
            return (
              <button
                key={spec.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(spec)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2 ${
                  selected
                    ? "border-[#F36F21] bg-[#F36F21] text-white"
                    : "border-mkt-border bg-mkt-card text-mkt-text hover:border-[#F36F21]"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {spec.label}
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl border border-mkt-border bg-mkt-card p-5 shadow-mkt">
          <p className="text-xs font-bold uppercase tracking-wide text-mkt-text-secondary">{active.label}</p>
          <p className="mt-1 text-2xl font-black text-mkt-text">{active.value}</p>
          <p className="mt-2 text-sm font-medium leading-relaxed text-mkt-text-secondary">{active.detail}</p>
          <p className="mt-3 flex items-start gap-2 text-xs font-semibold text-mkt-text-secondary">
            <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#F36F21]" aria-hidden="true" />
            Specifications are taken from the printed product sheet shipped with the unit.
          </p>
        </div>

        <ReceiptPrintDemo />

        <div>
          <button
            type="button"
            onClick={() => setSheetOpen((open) => !open)}
            aria-expanded={sheetOpen}
            className="inline-flex items-center gap-2 rounded-2xl border-2 border-mkt-border bg-mkt-card px-4 py-2.5 text-sm font-bold text-mkt-text transition hover:border-waka-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            {sheetOpen ? "Hide the full product sheet" : "See every side of it"}
          </button>

          {sheetOpen ? (
            <m.img
              src={sheetSrc}
              alt="WP-58 product sheet: front, side and back views, the underside label, USB-C charging, the paper cover and the logo panel, with the Waka orange and matte black colour palette"
              width={1440}
              height={960}
              loading="lazy"
              decoding="async"
              className="mt-4 w-full rounded-2xl border border-mkt-border bg-white shadow-mkt"
              initial={reduce ? undefined : { opacity: 0, y: 12 }}
              animate={reduce ? undefined : { opacity: 1, y: 0 }}
              transition={reduce ? undefined : { duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The printing animation                                                     */
/* -------------------------------------------------------------------------- */

/** A demonstration receipt. Deliberately a sample sale, not a real one. */
const SAMPLE_LINES: Array<{ label: string; value: string }> = [
  { label: "Sugar 1kg", value: "5,000" },
  { label: "Cooking oil 1L", value: "8,500" },
  { label: "Soap bar x2", value: "6,000" },
];

export function ReceiptPrintDemo() {
  // `run` only exists to remount the receipt below, which is how "Print again"
  // replays the animation without an effect resetting state on every press.
  const [run, setRun] = useState(0);

  return (
    <div className="rounded-2xl border border-mkt-border bg-mkt-card p-5 shadow-mkt">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-mkt-text-secondary">It prints the moment you sell</p>
        <button
          type="button"
          onClick={() => setRun((n) => n + 1)}
          className="inline-flex items-center gap-1.5 rounded-full border border-mkt-border px-3 py-1.5 text-xs font-bold text-mkt-text transition hover:border-waka-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Print again
        </button>
      </div>

      <ReceiptRun key={run} />

      <p className="mt-3 text-sm font-medium leading-relaxed text-mkt-text-secondary">
        Bluetooth to the phone or tablet you already use. No wires to the counter, and it keeps going when the power
        does not.
      </p>
    </div>
  );
}

/**
 * One printed receipt. Mounted fresh per press of "Print again" rather than
 * reset by an effect, so the reveal starts from the component's own initial
 * state and the effect below only ever sets state from a timer.
 */
function ReceiptRun() {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? SAMPLE_LINES.length : 0);

  // Reveal the printed lines one after another, the way a thermal head lays them
  // down. Reduced motion starts at the finished receipt — the animation is
  // decoration, and the information is the receipt itself.
  useEffect(() => {
    if (reduce) return;
    const timers = SAMPLE_LINES.map((_, index) =>
      window.setTimeout(() => setShown(index + 1), 260 * (index + 1)),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [reduce]);

  const total = SAMPLE_LINES.reduce((sum, line) => sum + Number(line.value.replace(/,/g, "")), 0);

  return (
    /* The slot the paper comes out of. */
    <div className="mt-3 overflow-hidden rounded-xl bg-[#1F1F21] p-3 pt-0">
      <div className="mx-auto h-2 w-4/5 rounded-b-md bg-black shadow-[inset_0_-2px_4px_rgba(255,255,255,0.12)]" />
      <div className="mx-auto w-4/5 overflow-hidden">
        <m.div
          className="bg-white px-3 pb-3 font-mono text-xs leading-relaxed text-black"
          initial={reduce ? false : { height: 0 }}
          animate={{ height: "auto" }}
          transition={reduce ? { duration: 0 } : { duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="pt-3 text-center text-xs font-bold uppercase tracking-wide">Waka POS · Sample receipt</p>
          <p className="mb-2 text-center text-xs text-black/60">Not a real sale</p>
          {SAMPLE_LINES.slice(0, shown).map((line) => (
            <span key={line.label} className="flex justify-between gap-2">
              <span>{line.label}</span>
              <span className="tabular-nums">{line.value}</span>
            </span>
          ))}
          {shown >= SAMPLE_LINES.length ? (
            <>
              <span className="mt-1 flex justify-between gap-2 border-t border-dashed border-black/30 pt-1 font-bold">
                <span>Total</span>
                <span className="tabular-nums">{total.toLocaleString("en-UG")}</span>
              </span>
              <span className="mt-1 flex items-center justify-center gap-1 text-xs text-black/60">
                <Check className="h-3 w-3" aria-hidden="true" /> Paid · Thank you
              </span>
            </>
          ) : null}
        </m.div>
      </div>
    </div>
  );
}
