import { Link } from "react-router-dom";
import { BadgeCheck, MapPin, MessageCircle, PackageCheck, ShieldCheck } from "lucide-react";
import { wakaSupportWhatsAppUrl } from "../../../config/company";

/**
 * How the printer actually reaches the customer.
 *
 * WHAT THIS SECTION DELIBERATELY DOES NOT DO. It shows no serial number, no
 * stock count and no "collected" confirmation, because none of that exists yet:
 * there is no printer inventory table, no serial registry and no fulfilment
 * record anywhere in the system (audited 2026-10-12). Inventing a plausible
 * serial or a fake tracking state would be inventing a capability we cannot
 * honour. So the section describes the journey in words, names the two real
 * routes, and points at the one contact channel that genuinely exists.
 *
 * It also does not activate anything. Subscribing happens through the existing
 * subscription flow, and the copy says so rather than implying a button here
 * grants a plan.
 */

type Step = {
  title: string;
  body: string;
  icon: typeof BadgeCheck;
};

const STEPS: Step[] = [
  {
    title: "Subscribe to Business annual",
    body: "Choose Business billed yearly in the app. Your Business features unlock as soon as the subscription is active — the printer is added to that, not instead of it.",
    icon: BadgeCheck,
  },
  {
    title: "We confirm the subscription is active",
    body: "Fulfilment follows an active subscription. Nothing is promised against a trial, and a payment that has not cleared does not qualify.",
    icon: ShieldCheck,
  },
  {
    title: "Choose how you want to collect",
    body: "Walk into the main branch and pick it up the same day, or message us on WhatsApp and we will arrange a time that suits you.",
    icon: MapPin,
  },
  {
    title: "Collect it and sign for it",
    body: "At handover we record the unit's serial number against your account and you confirm receipt. That record is what we support the printer against, so keep your copy.",
    icon: PackageCheck,
  },
];

export function PrinterFulfilment() {
  return (
    <div className="space-y-6">
      <ol className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.title} className="flex gap-4 rounded-2xl border border-mkt-border bg-mkt-card p-5 shadow-mkt">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-waka-50 text-waka-700 dark:bg-waka-950/50 dark:text-waka-300">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-mkt-text-secondary">Step {index + 1}</p>
                <h3 className="mt-0.5 text-base font-black text-mkt-text">{step.title}</h3>
                <p className="mt-1 text-sm font-medium leading-relaxed text-mkt-text-secondary">{step.body}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="rounded-2xl border border-mkt-border bg-mkt-bg-secondary p-5">
        <h3 className="text-base font-black text-mkt-text">Collect from the main branch, or ask us on WhatsApp</h3>
        <p className="mt-1 max-w-3xl text-sm font-medium leading-relaxed text-mkt-text-secondary">
          Both routes go through the same team. If you are not near the branch, message us and we will tell you what is
          possible for your location before you pay anything.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={wakaSupportWhatsAppUrl("Hello DKASU, I would like to ask about the free WP-58 printer with the Business annual plan.")}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-2xl bg-waka-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-orange-600/20 transition hover:bg-waka-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Ask on WhatsApp
          </a>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 rounded-2xl border-2 border-mkt-border bg-mkt-card px-5 py-3 text-sm font-bold text-mkt-text transition hover:border-waka-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2"
          >
            <MapPin className="h-4 w-4" aria-hidden="true" />
            Branch and contact details
          </Link>
        </div>
      </div>
    </div>
  );
}
