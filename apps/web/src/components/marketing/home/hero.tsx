import { HERO } from "@/content/marketing/home";
import { Link } from "@/i18n/navigation";
import { Arrow } from "./arrow";
import { Poster } from "./poster";

/** Chapter 1: the hero. Text first; the ribbon poster is the no-WebGL fallback. */
export function Hero() {
  return (
    <section id="top" data-ch="hero" aria-labelledby="h1">
      <div className="stage st-hero">
        <Poster />
        <div className="hero-labels">
          <p className="lbl">{HERO.labelLeft}</p>
          <p className="lbl">{HERO.labelRight}</p>
        </div>
        <h1 className="d1 kx" id="h1">
          <span className="l1 kx">{HERO.lineOne}</span>{" "}
          <span className="l2 kx">{HERO.lineTwo}</span>
        </h1>
        <div className="hero-body">
          <p className="lede">{HERO.lede}</p>
          <div className="ctas">
            <a className="btn btn-p" href="#talk">
              {HERO.demoCta} <Arrow />
            </a>
            <Link className="btn btn-s" href="/signup" prefetch={false}>
              {HERO.signupCta}
            </Link>
          </div>
          <p className="data fine">{HERO.price}</p>
        </div>
        <div className="hero-foot">
          <p className="data" id="hero-status">
            {HERO.status}
          </p>
          <p className="data cue">{HERO.cue}</p>
        </div>
      </div>
    </section>
  );
}
