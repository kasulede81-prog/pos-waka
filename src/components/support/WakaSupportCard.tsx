import { Mail, MapPin } from "lucide-react";
import {
  WAKA_COMPANY_LOCATION,
  WAKA_LEGAL_COMPANY_NAME,
  WAKA_SUPPORT_EMAILS,
  wakaSupportMailtoUrl,
} from "../../config/wakaSupport";

export function WakaSupportCard() {
  return (
    <section className="rounded-3xl border border-orange-100 bg-white p-5 shadow-waka-sm">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">Need help?</p>
      <h2 className="mt-1 text-xl font-black text-stone-950">{WAKA_LEGAL_COMPANY_NAME}</h2>
      <div className="mt-4 space-y-3 text-sm font-semibold text-stone-700">
        <div className="flex gap-3">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" aria-hidden />
          <div>
            <p className="text-[11px] font-black uppercase tracking-wide text-stone-500">Email</p>
            {WAKA_SUPPORT_EMAILS.map((email) => (
              <a key={email} href={wakaSupportMailtoUrl()} className="block text-orange-800 underline-offset-4 hover:underline">
                {email}
              </a>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" aria-hidden />
          <div>
            <p className="text-[11px] font-black uppercase tracking-wide text-stone-500">Location</p>
            <p>{WAKA_COMPANY_LOCATION}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
