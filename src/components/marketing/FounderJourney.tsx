import { Link } from "react-router-dom";
import {
  FOUNDER_JOURNEY_BUSINESS,
  FOUNDER_JOURNEY_EARLY,
  FOUNDER_JOURNEY_VISION,
  FOUNDER_WHY_WAKA,
} from "../../config/company";

type JourneyBlock = {
  title: string;
  body: string;
};

const FULL_JOURNEY: JourneyBlock[] = [
  { title: "Early journey", body: FOUNDER_JOURNEY_EARLY },
  { title: "Business background", body: FOUNDER_JOURNEY_BUSINESS },
  { title: "Vision for African businesses", body: FOUNDER_JOURNEY_VISION },
  { title: "Why Waka POS was created", body: FOUNDER_WHY_WAKA },
];

type Props = {
  /** Shorter version for About page */
  condensed?: boolean;
};

export function FounderJourney({ condensed = false }: Props) {
  const blocks = condensed ? FULL_JOURNEY.slice(0, 2) : FULL_JOURNEY;

  return (
    <section className="space-y-4" aria-labelledby="founder-journey-heading">
      <h2 id="founder-journey-heading" className="text-xl font-black text-stone-950">
        {condensed ? "Founder journey" : "The journey behind Waka"}
      </h2>
      <p className="text-sm font-medium text-stone-600">
        A real path — work abroad, prior businesses, and a deliberate focus on building Ugandan business software.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {blocks.map((block) => (
          <article
            key={block.title}
            className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm"
          >
            <h3 className="text-sm font-black text-orange-800">{block.title}</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-stone-700">{block.body}</p>
          </article>
        ))}
      </div>
      {condensed ? (
        <p className="text-sm font-medium text-stone-600">
          Read the full story on the{" "}
          <Link to="/founder" className="font-bold text-orange-800 underline">
            founder profile
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
