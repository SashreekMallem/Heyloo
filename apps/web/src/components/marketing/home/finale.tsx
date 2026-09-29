import { PRICING, START, TRUST } from "@/content/marketing/home";
import { Link } from "@/i18n/navigation";
import { Arrow } from "./arrow";
import { Talk } from "./talk";

function DisclosureQuote({ copy }: { copy: typeof TRUST.en | typeof TRUST.es }) {
  return (
    <blockquote className="qt kx">
      {copy.before}
      <mark>{copy.marks[0]}</mark>
      {copy.between}
      <mark>{copy.marks[1]}</mark>
      {copy.after}
    </blockquote>
  );
}

/** Finale 1: it always says it's an AI. English and Spanish, straight from the compiler's own wording. */
export function Trust() {
  return (
    <section id="trust" aria-labelledby="trust-h">
      <div className="fin-in">
        <p className="lbl">{TRUST.label}</p>
        <h2 className="d2 kin kx" id="trust-h">
          {TRUST.title}
        </h2>
        <div className="figs">
          <figure lang="en">
            <figcaption className="lbl" lang="en">
              {TRUST.en.caption}
            </figcaption>
            <DisclosureQuote copy={TRUST.en} />
          </figure>
          <figure lang="es">
            <figcaption className="lbl" lang="es">
              {TRUST.es.caption}
            </figcaption>
            <DisclosureQuote copy={TRUST.es} />
          </figure>
        </div>
        <p className="data tnote">{TRUST.note}</p>
        <ul className="points">
          {TRUST.points.map((point) => (
            <li key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Finale 3: the price, and what the money buys. */
export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-h">
      <div className="fin-in pr-grid">
        <div className="pr-num">
          <p className="lbl">{PRICING.label}</p>
          <h2 id="pricing-h">
            <span className="vh">{PRICING.srTitle}</span>
            <span className="pr-vis" aria-hidden="true">
              <span className="lbl">{PRICING.from}</span>
              <span className="num kx">{PRICING.number}</span>
              <span className="lbl">{PRICING.per}</span>
            </span>
          </h2>
          <p className="lede">{PRICING.lede}</p>
          <div className="ctas">
            <Link className="btn btn-p" href="/signup" prefetch={false}>
              Get started <Arrow />
            </Link>
            <a className="btn btn-s" href="#talk">
              Hear a live demo
            </a>
          </div>
          <Link className="lnk-inline data" href="/pricing" prefetch={false}>
            {PRICING.seePlans}
          </Link>
        </div>
        <div className="pr-list">
          <p className="lbl">{PRICING.listLabel}</p>
          <ul>
            {PRICING.list.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="data pr-note">{PRICING.note}</p>
        </div>
      </div>
    </section>
  );
}

/** The finale chapter: trust, the live demo, pricing, start. One scroll segment; the scene dims behind it. */
export function Finale({ demoPhone }: { demoPhone?: string | undefined }) {
  return (
    <div id="finale" data-ch="finale">
      <Trust />
      <Talk demoPhone={demoPhone} />
      <Pricing />
      <Start />
    </div>
  );
}

/** Finale 4: start today. */
export function Start() {
  return (
    <section id="start" aria-labelledby="start-h">
      <div className="fin-in">
        <p className="lbl">{START.label}</p>
        <h2 className="d1s kx" id="start-h">
          <span className="l1 kx">{START.lineOne}</span>{" "}
          <span className="l2 kx">{START.lineTwo}</span>
        </h2>
        <div className="st-row2">
          <p className="lede">{START.lede}</p>
          <div className="ctas">
            <Link className="btn btn-p" href="/signup" prefetch={false}>
              Get started <Arrow />
            </Link>
            <a className="btn btn-s" href="#talk">
              Hear a live demo
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
