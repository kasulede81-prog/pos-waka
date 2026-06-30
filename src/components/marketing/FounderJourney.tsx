import { Link } from "react-router-dom";
import {
  FOUNDER_JOURNEY_BUSINESS,
  FOUNDER_JOURNEY_QATAR,
  FOUNDER_VISION,
  FOUNDER_WHY_WAKA,
} from "../../config/company";

type JourneyBlock = {
  title: string;
  body: string;
};

const FULL_JOURNEY: JourneyBlock[] = [
  { title: "Earlier businesses", body: FOUNDER_JOURNEY_BUSINESS },
  { title: "Qatar, 2021", body: FOUNDER_JOURNEY_QATAR },
  { title: "Why Waka POS", body: FOUNDER_WHY_WAKA },
];

const CONDENSED_JOURNEY: JourneyBlock[] = [
  { title: "Background", body: FOUNDER_JOURNEY_BUSINESS },
  { title: "Why we built Waka POS", body: FOUNDER_WHY_WAKA },
];

type Props = {
  /** Shorter version for About page */
  condensed?: boolean;
  /** Show vision quote block (founder page) */
  showVision?: boolean;
};

export function FounderJourney({ condensed = false, showVision = false }: Props) {
  const blocks = condensed ? CONDENSED_JOURNEY : FULL_JOURNEY;

  return (
    <section className="space-y-4" aria-labelledby="founder-journey-heading">
      <h2 id="founder-journey-heading" className="text-xl font-black text-stone-950">
        {condensed ? "Founder journey" : "The story behind Waka"}
      </h2>
      {!condensed ? (
        <p className="text-sm font-medium text-stone-600">
          Real businesses, work abroad, and a clear focus on software for Ugandan shops.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {blocks.map((block) => (
          <article key={block.title} className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-black text-waka-">{block.title}</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-stone-700">{block.body}</p>
          </article>
        ))}
      </div>
      {showVision ? (
        <blockquote className="rounded-2xl border border-waka- bg-waka-/80 p-5">
          <p className="text-xs font-black uppercase tracking-wide text-waka-">Vision</p>
          <p className="mt-2 text-sm font-medium leading-relaxed text-stone-800">{FOUNDER_VISION}</p>
        </blockquote>
      ) : null}
      {condensed ? (
        <p className="text-sm font-medium text-stone-600">
          Read the full story on the{" "}
          <Link to="/founder" className="font-bold text-waka- underline">
            founder profile
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
