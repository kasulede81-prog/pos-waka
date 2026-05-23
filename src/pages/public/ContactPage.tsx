import { Mail, MapPin, Clock, Phone, MessageCircle } from "lucide-react";
import type { Language } from "../../types";
import { MarketingLayout } from "../../components/marketing/MarketingLayout";
import { SeoHead } from "../../components/marketing/SeoHead";
import {
  WAKA_COMPANY_POSTAL_ADDRESS,
  WAKA_BRAND_NAME,
  WAKA_MAIN_PRODUCT,
  WAKA_OFFICE_CITY,
  WAKA_OFFICE_HOURS,
  WAKA_OFFICE_STREET,
  WAKA_SUPPORT_EMAILS,
  wakaSupportMailtoUrl,
  wakaSupportWhatsAppUrl,
} from "../../config/company";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
};

export function ContactPage({ lang, setLang, isAuthenticated }: Props) {
  return (
    <MarketingLayout lang={lang} setLang={setLang} isAuthenticated={isAuthenticated}>
      <SeoHead
        title="Contact Waka POS — Kampala, Uganda"
        description={`Contact ${WAKA_BRAND_NAME} for ${WAKA_MAIN_PRODUCT} support, sales, and office visits in Kampala, Uganda.`}
        path="/contact"
        structuredData="contact"
      />

      <article className="space-y-8">
        <header className="space-y-3">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-700">Contact</p>
          <h1 className="text-4xl font-black text-stone-950">Talk to the Waka team</h1>
          <p className="text-base font-medium text-stone-600">
            We are based in Kampala and support businesses across Uganda. Reach us by WhatsApp, email, or visit our
            office during working hours.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <a
            href={wakaSupportWhatsAppUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-4 text-lg font-black text-white shadow-md"
          >
            <MessageCircle className="h-6 w-6" aria-hidden />
            WhatsApp support
          </a>
          <a
            href={wakaSupportMailtoUrl("Waka POS enquiry")}
            className="flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border-2 border-orange-200 bg-orange-50 px-4 py-4 text-lg font-black text-orange-950"
          >
            <Mail className="h-6 w-6 text-orange-700" aria-hidden />
            Email us
          </a>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ContactCard icon={Mail} title="Email">
            {WAKA_SUPPORT_EMAILS.map((email) => (
              <a key={email} href={`mailto:${email}`} className="block text-orange-800 underline-offset-2 hover:underline">
                {email}
              </a>
            ))}
          </ContactCard>
          <ContactCard icon={Phone} title="Phone">
            <p className="text-stone-700">+256 792 521 711</p>
            <p className="mt-1 text-xs text-stone-500">WhatsApp preferred for faster support</p>
          </ContactCard>
          <ContactCard icon={MapPin} title="Office address">
            <p>{WAKA_OFFICE_STREET}</p>
            <p className="mt-1">{WAKA_OFFICE_CITY}, Uganda</p>
            <p className="mt-2 text-xs text-stone-500">Postal: {WAKA_COMPANY_POSTAL_ADDRESS}</p>
          </ContactCard>
          <ContactCard icon={Clock} title="Office hours">
            <p>{WAKA_OFFICE_HOURS.weekdays}</p>
            <p className="mt-1">{WAKA_OFFICE_HOURS.saturday}</p>
            <p className="mt-1">{WAKA_OFFICE_HOURS.sunday}</p>
          </ContactCard>
        </div>

        <section className="overflow-hidden rounded-3xl border border-stone-200 bg-stone-100">
          <div className="flex aspect-[16/9] flex-col items-center justify-center gap-2 p-8 text-center">
            <MapPin className="h-10 w-10 text-orange-600" aria-hidden />
            <p className="text-sm font-black text-stone-800">Map — Kampala office</p>
            <p className="max-w-md text-xs font-medium text-stone-600">
              Opposite Freedom City, Namasuba – Kikajjo Road. Add your Google Maps embed here when ready.
            </p>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${WAKA_OFFICE_STREET}, Kampala, Uganda`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 text-sm font-bold text-orange-800 underline"
            >
              Open in Google Maps →
            </a>
          </div>
        </section>
      </article>
    </MarketingLayout>
  );
}

function ContactCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Mail;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-orange-100 bg-white p-5 shadow-waka-sm">
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" aria-hidden />
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide text-stone-500">{title}</p>
          <div className="mt-2 space-y-1 text-sm font-semibold">{children}</div>
        </div>
      </div>
    </div>
  );
}
