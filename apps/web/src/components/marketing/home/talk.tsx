import { TalkLive } from "@/components/demo/talk-live";
import { TALK } from "@/content/marketing/talk";

/**
 * Finale 2: talk to Heyloo now. The copy is server-rendered; only the call
 * card is a client island. `#talk` is where every "Hear a live demo" button
 * on the page lands, so the disclosure is on screen before the call starts.
 */
export function Talk({ demoPhone }: { demoPhone?: string | undefined }) {
  return (
    <section id="talk" aria-labelledby="talk-h">
      <div className="fin-in tk-grid">
        <div className="tk-copy">
          <p className="lbl">{TALK.label}</p>
          <h2 className="d2s kin kx" id="talk-h">
            {TALK.title}
          </h2>
          <p className="lede">{TALK.lede}</p>
        </div>
        <TalkLive demoPhone={demoPhone} />
      </div>
    </section>
  );
}
