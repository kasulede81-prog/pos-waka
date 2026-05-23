import { useI18n } from "@/lib/i18n";

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="inline-flex items-center rounded-full bg-muted p-1 text-xs font-bold">
      <button
        onClick={() => setLang("en")}
        className={`rounded-full px-2.5 py-1 transition ${
          lang === "en" ? "bg-primary text-primary-foreground" : "text-foreground/60"
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLang("lg")}
        className={`rounded-full px-2.5 py-1 transition ${
          lang === "lg" ? "bg-primary text-primary-foreground" : "text-foreground/60"
        }`}
      >
        LG
      </button>
    </div>
  );
}
