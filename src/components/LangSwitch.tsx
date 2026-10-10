import { LANGS, lang, setLang, t } from "../lib/i18n";

export function LangSwitch() {
  return (
    <div className="when lang" role="group" aria-label={t("Language")}>
      {LANGS.map((option) => (
        <button key={option.id} type="button" aria-pressed={option.id === lang} onClick={() => setLang(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
