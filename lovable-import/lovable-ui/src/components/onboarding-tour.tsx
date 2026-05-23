import { useEffect, useState } from "react";
import { X, ArrowRight, Sparkles } from "lucide-react";

const KEY = "waka.tour.done.v1";

const STEPS = [
  {
    title: "Welcome to Waka POS 👋",
    body: "A 30-second tour so you can start selling fast. Works offline and syncs to the cloud when you have data.",
  },
  {
    title: "Sell in seconds",
    body: "Open the Sell tab, tap a product to add it, then take payment (Cash, MoMo or Credit).",
  },
  {
    title: "Stock & customers",
    body: "Use Products to add what you sell, and Customers to track who owes you (mpa mpaka).",
  },
  {
    title: "Keyboard shortcuts",
    body: "Press F1=Sell, F2=Products, F3=Customers, F4=Receipts, F5=Dashboard. Press Esc to close pop-ups.",
  },
  {
    title: "Staff PIN",
    body: "Add cashiers from the Staff button (top right). Each one logs in with their own PIN — no need to sign out.",
  },
];

export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {}
  }, []);

  const close = () => {
    try { localStorage.setItem(KEY, "1"); } catch {}
    setOpen(false);
  };

  if (!open) return null;
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-3xl bg-background p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-waka-100 px-3 py-1 text-xs font-black text-waka-700">
            <Sparkles className="h-3.5 w-3.5" /> Quick tour · {i + 1}/{STEPS.length}
          </span>
          <button onClick={close} className="rounded-full p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        <h2 className="mt-4 text-xl font-black">{step.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>

        <div className="mt-6 flex gap-2">
          {i > 0 && (
            <button onClick={() => setI(i - 1)} className="rounded-full border border-border px-4 py-2 text-sm font-bold">
              Back
            </button>
          )}
          <button
            onClick={() => (last ? close() : setI(i + 1))}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-waka-600 px-4 py-2.5 text-sm font-bold text-primary-foreground"
          >
            {last ? "Get started" : "Next"} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <button onClick={close} className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground">
          Skip tour
        </button>
      </div>
    </div>
  );
}
