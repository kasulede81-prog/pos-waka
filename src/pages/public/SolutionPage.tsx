import { Navigate, useParams } from "react-router-dom";
import type { Language } from "../../types";
import { SolutionLandingPage } from "../../components/marketing/SolutionLandingPage";
import { getSolutionPage } from "../../config/solutionPages";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
};

export function SolutionPage({ lang, setLang, isAuthenticated }: Props) {
  const { solutionSlug = "" } = useParams<{ solutionSlug: string }>();
  const content = getSolutionPage(solutionSlug);

  if (!content) {
    return <Navigate to="/home" replace />;
  }

  return (
    <SolutionLandingPage lang={lang} setLang={setLang} isAuthenticated={isAuthenticated} content={content} />
  );
}
