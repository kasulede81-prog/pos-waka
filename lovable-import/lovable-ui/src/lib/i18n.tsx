import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "lg";

type Dict = Record<string, string>;

const en: Dict = {
  "brand.company": "Waka Technologies",
  "brand.product": "Waka POS",
  "brand.slogan": "Tech for next generation",
  "brand.legal": "WAKA MARKETPLACE LIMITED",

  "nav.home": "Home",
  "nav.about": "About",
  "nav.contact": "Contact",
  "nav.support": "Support",
  "nav.founder": "Founder",
  "nav.company": "Company",
  "nav.demo": "Try demo",
  "nav.login": "Sign in",
  "nav.register": "Get started",

  "home.hero.eyebrow": "Built for Ugandan shops",
  "home.hero.title": "Run your shop with confidence",
  "home.hero.subtitle":
    "Track sales, stock, debts and suppliers. Works offline. Syncs when you have data.",
  "home.hero.cta.primary": "Get started free",
  "home.hero.cta.secondary": "Try the demo",
  "home.features.title": "Everything your duka needs",
  "home.features.sell.title": "Sell in seconds",
  "home.features.sell.body": "Touch grid, money mode, quick presets. Cash, mobile money or credit.",
  "home.features.stock.title": "Simple stock",
  "home.features.stock.body": "Add products in 7 easy steps. We do the pack math for you.",
  "home.features.debt.title": "Mpa mpaka",
  "home.features.debt.body": "Track customer debts and supplier balances without the headache.",
  "home.features.offline.title": "Works offline",
  "home.features.offline.body": "Power off? Network down? Keep selling. We sync when you reconnect.",
  "home.pricing.title": "Start free, grow with us",
  "home.pricing.body":
    "Free plan up to 10 products. Upgrade when your shop is ready. Pay in UGX.",
  "home.founder.title": "From a Ugandan shopkeeper's son",
  "home.founder.body":
    "Waka POS is built by Kasule Denis to help every Ugandan business owner run their shop with pride.",
  "home.cta.title": "Ready to run your shop the smart way?",
  "home.cta.create": "Create your shop",

  "about.title": "About Waka Technologies",
  "about.intro":
    "We build simple, trustworthy tools for African small businesses. Waka POS is our first product.",
  "about.vision.title": "Our vision",
  "about.vision.body":
    "Every Ugandan shop owner — from the smallest duka to the busiest supermarket — deserves software that respects their time and their language.",
  "about.values.title": "What we stand for",
  "about.values.simple": "Simple. No jargon. No setup pain.",
  "about.values.offline": "Offline-first. Built for real Ugandan conditions.",
  "about.values.local": "Local. In English and Luganda, with more languages to come.",
  "about.values.trust": "Trust. Your data is yours.",

  "contact.title": "Get in touch",
  "contact.intro": "We are here Monday to Saturday.",
  "contact.whatsapp": "WhatsApp",
  "contact.email": "Email",
  "contact.office": "Office",
  "contact.hours": "Hours",
  "contact.hours.value": "Mon–Sat, 8:00 – 18:00 EAT",
  "contact.office.value": "Kampala, Uganda",

  "founder.title": "Kasule Denis",
  "founder.role": "Founder, Waka Technologies",
  "founder.body":
    "Kasule grew up around his family's small shop. He started Waka Technologies to give every Ugandan business owner the same tools the big retailers have — without the cost or complexity.",

  "company.title": "Company information",
  "company.intro":
    "Waka POS is a product of Waka Technologies. Invoices, terms and privacy are issued by our registered entity.",
  "company.legal_name": "Registered legal entity",

  "demo.title": "Try the demo",
  "demo.body":
    "The full demo loads with sample data so you can see how Waka POS works. Coming with the POS module.",
  "demo.cta": "Back to home",

  "support.title": "We are here to help",
  "support.body": "Reach us by WhatsApp or email — usually within a few hours.",

  "legal.terms": "Terms & conditions",
  "legal.privacy": "Privacy policy",
  "legal.refund": "Refund policy",
  "legal.acceptable": "Acceptable use",
  "legal.intro":
    "This policy is issued by WAKA MARKETPLACE LIMITED. Plain-language summary below — the full agreement governs your use of Waka POS.",

  "auth.welcome": "Welcome back",
  "auth.welcome.body": "Sign in to your Waka POS account.",
  "auth.signup.title": "Create your shop",
  "auth.signup.body": "Start free in less than a minute.",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.signin": "Sign in",
  "auth.signup": "Create account",
  "auth.continue_google": "Continue with Google",
  "auth.or": "or",
  "auth.no_account": "New to Waka POS?",
  "auth.have_account": "Already have an account?",
  "auth.forgot": "Forgot password?",
  "auth.shop_name": "Shop name",
  "auth.owner_name": "Your full name",
  "auth.phone": "Mobile (07… or +256…)",
  "auth.verify.title": "Check your email",
  "auth.verify.body": "We sent you a link to confirm your address. Open it on this device.",
  "auth.forgot.title": "Reset your password",
  "auth.forgot.body": "Enter your email and we'll send a reset link.",
  "auth.forgot.send": "Send reset link",
  "auth.recovery.title": "Set a new password",
  "auth.recovery.body": "Choose a strong password you'll remember.",
  "auth.recovery.update": "Update password",
  "auth.signout": "Sign out",
  "auth.back_home": "Back to home",

  "app.dashboard": "Dashboard",
  "app.home": "Home",
  "app.sell": "Sell",
  "app.receipts": "Receipts",
  "app.sales_history": "Sales History",
  "app.products": "Stock",
  "app.customers": "Mpa mpaka",
  "app.office": "Office",
  "app.back_office": "Back Office",
  "app.dashboard.welcome": "Welcome to Waka POS",
  "app.dashboard.body":
    "Your shop tools are below. Tap Sell to start ringing up.",

  "sync.saved": "All changes saved",
  "sync.syncing": "Syncing…",
  "sync.queued": "{n} change waiting to sync",
  "sync.queued_plural": "{n} changes waiting to sync",
  "sync.offline": "Offline — changes saved locally",
  "sync.error": "Sync error — will retry",

  "empty.quick_products.title": "No quick products yet",
  "empty.quick_products.body": "Add products to your shop and your favourites will appear here.",
  "empty.quick_products.cta": "Add a product",
  "empty.today_sales.title": "No sales yet today",
  "empty.today_sales.body": "Your first sale of the day will show up right here.",
  "empty.today_sales.cta": "Start selling",
  "empty.selling_fast.title": "Nothing trending yet",
  "empty.selling_fast.body": "Once you ring up a few sales, your fastest movers appear here.",
  "empty.running_low.title": "Stock looking healthy",
  "empty.running_low.body": "Nothing is running low. We'll warn you when items drop to 5 or fewer.",

  "profile.finish.title": "Finish your business profile first",
  "profile.finish.body":
    "Add your shop name and phone so receipts, sync and reports work everywhere.",
  "profile.finish.shop": "Shop name",
  "profile.finish.owner": "Owner full name",
  "profile.finish.phone": "Mobile (07… or +256…)",
  "profile.finish.save": "Save and continue",
  "profile.finish.saving": "Saving…",

  "footer.about": "About",
  "footer.contact": "Contact",
  "footer.terms": "Terms",
  "footer.privacy": "Privacy",
  "footer.copyright": "© {year} {legal}. All rights reserved.",
  "footer.note": "Waka POS is a product of Waka Technologies.",

  "lang.en": "EN",
  "lang.lg": "LG",
};

const lg: Dict = {
  ...en,
  "brand.slogan": "Tekinologiya ku mulembe omupya",
  "nav.home": "Awaka",
  "nav.about": "Ku ffe",
  "nav.contact": "Tutuukirire",
  "nav.support": "Obuyambi",
  "nav.founder": "Eyatandiseewo",
  "nav.company": "Kampuni",
  "nav.demo": "Geza",
  "nav.login": "Yingira",
  "nav.register": "Tandika",

  "home.hero.eyebrow": "Yazimbiddwa ku bizinensi z'e Uganda",
  "home.hero.title": "Dduuka lyo lifuge n'obwesige",
  "home.hero.subtitle":
    "Manya bya wakola, ebizibu by'amabbaanja, n'aboleeta. Kikola n'awatali yintaneeti. Bisindika nga ofunye data.",
  "home.hero.cta.primary": "Tandika obwereere",
  "home.hero.cta.secondary": "Geza demo",

  "home.features.title": "Byonna ebituufu ku duuka lyo",
  "home.features.sell.title": "Tunda mu kasonsenkere",
  "home.features.sell.body": "Kwata ebintu, ssente, oba quick presets. Cash, mobile money oba mpa mpaka.",
  "home.features.stock.title": "Stock entangaavu",
  "home.features.stock.body": "Yongerako ebintu mu makubo musanvu. Ffe tubala ennamba.",
  "home.features.debt.title": "Mpa mpaka",
  "home.features.debt.body": "Manya bannakatale n'aboleeta abalina amabbaanja awatali kutawanyizibwa.",
  "home.features.offline.title": "Kikola awatali yintaneeti",
  "home.features.offline.body": "Yintaneeti egwaalewo? Yongera okutunda. Tujja kusindika nga okomyewo.",

  "home.pricing.title": "Tandika obwereere, gende n'effe",
  "home.pricing.body":
    "Plan ya bwereere ku bintu 10. Wegula nga osobola. Sasula mu UGX.",
  "home.founder.title": "Okuva ku mwana w'omusuubuzi",
  "home.founder.body":
    "Waka POS yazimbiddwa Kasule Denis okuyamba buli musuubuzi wa Uganda okufuga duuka lye n'amalala.",
  "home.cta.title": "Weetegese okufuga duuka lyo mu ngeri esinga?",
  "home.cta.create": "Tandika duuka lyo",

  "about.title": "Ku Waka Technologies",
  "about.intro":
    "Tuzimba ebikola ebyangu era ebyesigika ku bizinensi entono ez'Africa. Waka POS y'ekintu kyaffe ekisooka.",
  "about.vision.title": "Ekituuse kyaffe",
  "about.vision.body":
    "Buli musuubuzi wa Uganda asaanidde software emussa ekitiibwa mu budde n'olulimi lwe.",

  "contact.title": "Tutuukirire",
  "contact.intro": "Tuliwo okuva ku Balaza okutuuka ku Lwomukaaga.",
  "contact.whatsapp": "WhatsApp",
  "contact.email": "Imeeli",
  "contact.office": "Ofiisi",
  "contact.hours": "Essaawa",
  "contact.hours.value": "Bal–Lwomukaaga, 8:00 – 18:00 EAT",
  "contact.office.value": "Kampala, Uganda",

  "auth.welcome": "Tukusanyuse okukomawo",
  "auth.welcome.body": "Yingira mu akawunti yo eya Waka POS.",
  "auth.signup.title": "Tandika duuka lyo",
  "auth.signup.body": "Tandika obwereere mu kasera katono.",
  "auth.email": "Imeeli",
  "auth.password": "Pasiwedi",
  "auth.signin": "Yingira",
  "auth.signup": "Tandikawo akawunti",
  "auth.continue_google": "Genda mu maaso na Google",
  "auth.or": "oba",
  "auth.no_account": "Mupya ku Waka POS?",
  "auth.have_account": "Olina dda akawunti?",
  "auth.forgot": "Weerabidde pasiwedi?",
  "auth.shop_name": "Erinnya ly'edduuka",
  "auth.owner_name": "Erinnya lyo erijjuvu",
  "auth.phone": "Esimu (07… oba +256…)",
  "auth.signout": "Fuluma",
  "auth.back_home": "Komawo awaka",

  "app.dashboard": "Awaka",
  "app.home": "Awaka",
  "app.sell": "Tunda",
  "app.receipts": "Risiiti",
  "app.sales_history": "Eby'okutunda",
  "app.products": "Stock",
  "app.customers": "Mpa mpaka",
  "app.office": "Ofiisi",
  "app.back_office": "Ofiisi y'emabega",
  "app.dashboard.welcome": "Tukusanyuse ku Waka POS",
  "app.dashboard.body":
    "Ebikozesebwa by'edduuka lyo biri wansi. Kwata Tunda otandike.",

  "sync.saved": "Byonna byaterekeddwa",
  "sync.syncing": "Tusindika…",
  "sync.queued": "Ekibinja {n} kirinda okusindikibwa",
  "sync.queued_plural": "Ebibinja {n} birinda okusindikibwa",
  "sync.offline": "Tewali yintaneeti — byaterekeddwa wano",
  "sync.error": "Wabaddewo ekizibu — tunaagezaako nate",

  "profile.finish.title": "Maliriza profile yo eya bizinensi",
  "profile.finish.body":
    "Wandiika erinnya ly'edduuka n'esimu okusobola risiiti n'okusindika kukola bulungi.",
  "profile.finish.shop": "Erinnya ly'edduuka",
  "profile.finish.owner": "Erinnya lyo erijjuvu",
  "profile.finish.phone": "Esimu (07… oba +256…)",
  "profile.finish.save": "Tereka ogende mu maaso",
  "profile.finish.saving": "Tutereka…",

  "footer.note": "Waka POS kintu kya Waka Technologies.",
};

const dicts: Record<Lang, Dict> = { en, lg };

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("waka.lang") : null;
    if (stored === "en" || stored === "lg") setLangState(stored);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem("waka.lang", l);
  };

  const t = (key: string, vars?: Record<string, string | number>) => {
    let s = dicts[lang][key] ?? dicts.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(`{${k}}`, String(v));
      }
    }
    return s;
  };

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
