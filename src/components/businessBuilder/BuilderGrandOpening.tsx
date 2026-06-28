import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Language } from "../../types";
import { useBusinessBuilder } from "../../context/BusinessBuilderContext";
import { BusinessBuilderScene } from "./BusinessBuilderScene";
import { BuilderPrimaryButton } from "./BuilderField";
import { t } from "../../lib/i18n";
import { hapticTap } from "../../lib/nativeFeedback";
import { usePosStore } from "../../store/usePosStore";

const BuilderConfetti = lazy(() =>
  import("./BuilderConfetti").then((m) => ({ default: m.BuilderConfetti })),
);

type Props = {
  lang: Language;
  onComplete?: () => void;
};

export function BuilderGrandOpening({ lang, onComplete }: Props) {
  const navigate = useNavigate();
  const { scene, patchScene } = useBusinessBuilder();
  const hapticsOn = usePosStore((s) => s.preferences.hapticsOn ?? true);
  const [phase, setPhase] = useState<"idle" | "animating" | "done">("idle");
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (phase !== "animating") return;
    patchScene({ isOpen: true, hasPrinter: true, hasCloudSync: true });
    const t1 = window.setTimeout(() => setShowConfetti(true), 400);
    const t2 = window.setTimeout(() => {
      patchScene({ grandOpeningPlayed: true });
      setPhase("done");
    }, 2800);
    const t3 = window.setTimeout(() => {
      onComplete?.();
      navigate("/", { replace: true });
    }, 4200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [phase, navigate, onComplete, patchScene]);

  const open = () => {
    if (phase !== "idle" || scene.grandOpeningPlayed) {
      navigate("/", { replace: true });
      return;
    }
    if (hapticsOn) void hapticTap();
    setPhase("animating");
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-[#1e1b4b] via-[#312e81] to-[#1c1917] px-6">
      {showConfetti ? (
        <Suspense fallback={null}>
          <BuilderConfetti className="pointer-events-none absolute inset-0" />
        </Suspense>
      ) : null}

      <div className="w-full max-w-md space-y-6 text-center">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-300">
          {t(lang, "builderGrandOpeningKicker")}
        </p>
        <h1 className="text-3xl font-black text-white sm:text-4xl">{t(lang, "builderGrandOpeningTitle")}</h1>
        <div className="overflow-hidden rounded-[32px] border border-white/10 bg-white/5 p-4 backdrop-blur-md">
          <BusinessBuilderScene className="mx-auto max-w-sm" lang={lang} />
        </div>

        <div className="grid grid-cols-2 gap-2 text-left text-xs font-semibold text-white/80">
          <span className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
            {t(lang, "builderGrandStat1")}
          </span>
          <span className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
            {t(lang, "builderGrandStat2")}
          </span>
          <span className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
            {t(lang, "builderGrandStat3")}
          </span>
          <span className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
            {t(lang, "builderGrandStat4")}
          </span>
        </div>

        <BuilderPrimaryButton
          type="button"
          disabled={phase === "animating"}
          onClick={open}
          className="!rounded-[32px] text-xl"
        >
          {phase === "animating" ? t(lang, "builderOpening") : `🚀 ${t(lang, "builderOpenMyBusiness")}`}
        </BuilderPrimaryButton>
      </div>
    </div>
  );
}
