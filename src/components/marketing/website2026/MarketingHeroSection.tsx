import { Link } from "react-router-dom";
import clsx from "clsx";
import { ArrowRight, Download, Play, WifiOff, Cloud, HeadphonesIcon } from "lucide-react";
import { FloatCard, Reveal } from "./MarketingMotion";
import {
  mktBtnPrimary,
  mktBtnSecondary,
  mktChartBar,
  mktChip,
  mktDeviceFrame,
  mktEyebrow,
  mktHeading,
  mktHeroGlow,
  mktSubtext,
} from "../marketingThemeClasses";

type Props = {
  isAuthenticated: boolean;
};

export function MarketingHeroSection({ isAuthenticated }: Props) {
  return (
    <section className="relative overflow-hidden pt-4 pb-16 sm:pt-8 sm:pb-24 lg:pb-28">
      <div className={mktHeroGlow} />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-mkt-bg-secondary/80 via-mkt-bg to-mkt-bg transition-[background] duration-500 dark:from-mkt-bg-secondary/40 dark:via-mkt-bg dark:to-mkt-bg" />
      <div className="pointer-events-none absolute -right-24 top-1/4 -z-10 h-72 w-72 rounded-full bg-orange-500/10 blur-3xl transition-[background] duration-500 dark:bg-orange-500/20" />

      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <Reveal>
          <p className={mktEyebrow}>Waka POS · Uganda</p>
          <h1 className={`mt-4 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.35rem] ${mktHeading}`}>
            Run Your Business <span className="text-orange-600 dark:text-orange-400">Smarter.</span>
          </h1>
          <p className={`mt-5 max-w-xl text-lg font-medium leading-relaxed sm:text-xl ${mktSubtext}`}>
            Uganda&apos;s offline-first POS built for shops, restaurants, pharmacies, and growing businesses — sales,
            inventory, debts, and reports in one calm workspace.
          </p>

          <ul className="mt-6 flex flex-wrap gap-3 text-sm font-bold text-mkt-text">
            <li className={mktChip}>
              <WifiOff className="h-4 w-4 text-orange-600 dark:text-orange-400" aria-hidden /> Offline first
            </li>
            <li className={mktChip}>
              <Cloud className="h-4 w-4 text-orange-600 dark:text-orange-400" aria-hidden /> Cloud sync
            </li>
            <li className={mktChip}>
              <HeadphonesIcon className="h-4 w-4 text-orange-600 dark:text-orange-400" aria-hidden /> Local support
            </li>
          </ul>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to={isAuthenticated ? "/" : "/register"}
              className={clsx(mktBtnPrimary, "min-h-[52px] gap-2 px-7 py-3 text-base shadow-lg shadow-orange-600/25 hover:bg-orange-700")}
            >
              Start Free — UGX 0
              <ArrowRight className="h-5 w-5" aria-hidden />
            </Link>
            <Link to="/demo" className={clsx(mktBtnSecondary, "min-h-[52px] gap-2 px-6 py-3 text-base")}>
              <Play className="h-4 w-4 text-orange-600 dark:text-orange-400" aria-hidden />
              Watch Demo
            </Link>
            <a
              href="https://play.google.com/store/apps/details?id=ug.waka.pos"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[52px] items-center gap-2 rounded-2xl px-4 py-3 text-base font-bold text-mkt-text-secondary transition duration-300 hover:text-orange-600 dark:hover:text-orange-400"
            >
              <Download className="h-4 w-4" aria-hidden />
              Download App
            </a>
          </div>
        </Reveal>

        <Reveal delay={0.12} className="relative mx-auto w-full max-w-xl lg:max-w-none">
          <DeviceShowcase />
        </Reveal>
      </div>
    </section>
  );
}

function DeviceShowcase() {
  return (
    <div className="relative mx-auto aspect-[4/3] max-h-[520px] w-full">
      <FloatCard delay={0} className={clsx(mktDeviceFrame, "absolute left-[4%] top-[8%] w-[58%] shadow-2xl")}>
        <div className="overflow-hidden rounded-xl bg-stone-950 ring-1 ring-mkt-border/50">
          <div className="flex items-center gap-1.5 border-b border-stone-800 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="ml-2 text-[10px] font-bold text-stone-500">Waka POS · Sell</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 p-2">
            {["Rice", "Sugar", "Soap", "Soda", "Bread", "Oil", "Eggs", "Milk"].map((p) => (
              <div key={p} className="rounded-lg bg-stone-800/80 p-2 text-center">
                <div className="mx-auto mb-1 h-6 w-6 rounded-md bg-orange-500/30" />
                <p className="truncate text-[9px] font-bold text-stone-200">{p}</p>
              </div>
            ))}
          </div>
        </div>
      </FloatCard>

      <FloatCard
        delay={1.2}
        className="absolute right-[2%] top-[18%] w-[34%] rounded-[1.4rem] border-[3px] border-stone-900 bg-stone-900 p-1.5 shadow-xl ring-1 ring-orange-500/20 dark:ring-orange-500/40"
      >
        <div className="overflow-hidden rounded-[1rem] bg-white">
          <div className="bg-orange-600 px-2 py-2 text-center text-[9px] font-black text-white">Today · UGX 842K</div>
          <div className="grid grid-cols-2 gap-1 p-2">
            {["Sell", "Stock", "Debts", "Reports"].map((t) => (
              <div key={t} className="rounded-lg bg-stone-100 py-2 text-center text-[8px] font-black text-stone-700">
                {t}
              </div>
            ))}
          </div>
        </div>
      </FloatCard>

      <FloatCard delay={0.6} className={clsx(mktDeviceFrame, "absolute bottom-[6%] left-[18%] w-[28%]")}>
        <p className="text-[9px] font-bold uppercase tracking-wide text-mkt-text-secondary">Analytics</p>
        <p className="text-lg font-black text-orange-700 dark:text-orange-400">+18%</p>
        <div className="mt-1 flex h-8 items-end gap-0.5">
          {[40, 55, 35, 70, 50, 80, 65].map((h, i) => (
            <div key={i} className={clsx(mktChartBar, "flex-1")} style={{ height: `${h}%` }} />
          ))}
        </div>
      </FloatCard>

      <div className="absolute bottom-[10%] right-[8%] rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-black text-emerald-800 shadow-md dark:border-emerald-500/30 dark:bg-emerald-950/60 dark:text-emerald-300">
        Synced ✓
      </div>
      <div className="absolute left-[8%] top-[2%] rounded-full border border-orange-200 bg-mkt-card px-3 py-1.5 text-[10px] font-black text-orange-800 shadow-md dark:border-orange-500/30 dark:text-orange-300">
        Offline ready
      </div>
    </div>
  );
}
