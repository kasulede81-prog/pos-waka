import { Mail, MapPin } from "lucide-react";
import {
  WAKA_COMPANY_LOCATION,
  WAKA_LEGAL_COMPANY_NAME,
  WAKA_SUPPORT_EMAILS,
  wakaSupportMailtoUrl,
} from "../../config/wakaSupport";

export function WakaSupportCard() {
  return (
    <section className="rounded-3xl border border-waka-100 bg-card p-5 shadow-waka-sm">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-waka-700">Need help?</p>
      <h2 className="mt-1 text-xl font-black text-foreground">{WAKA_LEGAL_COMPANY_NAME}</h2>
      <div className="mt-4 space-y-3 text-sm font-semibold text-muted-foreground">
        <div className="flex gap-3">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-waka-600" aria-hidden />
          <div>
            <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Email</p>
            {WAKA_SUPPORT_EMAILS.map((email) => (
              <a key={email} href={wakaSupportMailtoUrl()} className="block text-waka-800 underline-offset-4 hover:underline">
                {email}
              </a>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-waka-600" aria-hidden />
          <div>
            <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Location</p>
            <p>{WAKA_COMPANY_LOCATION}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
