import { CALL, CALL_BEATS, CALL_LINES, CALL_TOOLS } from "@/content/marketing/home";
import { clock } from "./voice-model";

/**
 * Chapter 3: one call, start to finish. The full transcript is server-rendered
 * (`.script`), readable with no JS and by screen readers; the runtime builds
 * the karaoke captions from it.
 */
export function Call() {
  return (
    <section id="call" data-ch="call" aria-labelledby="call-h">
      <div className="stage st-call">
        <div className="call-head">
          <p className="lbl">{CALL.label}</p>
          <h2 className="d2s kin kx" id="call-h">
            {CALL.title}
          </h2>
          <p className="lede">{CALL.lede}</p>
        </div>
        <div className="strip panel" data-state="booked">
          <div className="st-row">
            <p className="lbl st-lbl">{CALL.stripLabel}</p>
            <span className="chip st-chip">Booked</span>
            <span className="st-t data" id="st-t">
              0:58
            </span>
          </div>
          <p className="st-who">
            <span className="st-num data">{CALL.stripNumber}</span>
            <span className="st-biz data">{CALL.stripBusiness}</span>
          </p>
          <div className="lvl-row" aria-hidden="true">
            <span className="lvl-who data" id="lvl-who">
              Ava
            </span>
            <span className="lvl">
              <i />
            </span>
          </div>
          <ul className="tools">
            {CALL_TOOLS.map((tool) => (
              <li className="chip" data-at={tool.at} key={tool.label}>
                {tool.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="capzone" aria-hidden="true" />
        <ol className="beats">
          {CALL_BEATS.map((beat, i) => (
            <li className="beat" key={beat.title}>
              <span className="bn data">{String(i + 1).padStart(2, "0")}</span>
              <span className="bt">{beat.title}</span>
              <span className="bd">{beat.detail}</span>
              <i className="bp">
                <b />
              </i>
            </li>
          ))}
        </ol>
        <a className="skipcall data" href="#dashboard">
          {CALL.skip}
        </a>
        <ol id="call-script" className="script">
          {CALL_LINES.map((line) => (
            <li
              key={line.t0}
              data-spk={line.speaker}
              data-t0={line.t0.toFixed(1)}
              data-t1={line.t1.toFixed(1)}
            >
              <span className="tt data">{clock(line.t0)}</span>
              <b className="who">{line.speaker === "ava" ? "Ava" : "Caller"}</b>
              <span className="tx">{line.text}</span>
            </li>
          ))}
        </ol>
        <aside className="sms panel">
          <p className="lbl">{CALL.smsLabel}</p>
          <p className="sms-b">{CALL.smsBody}</p>
          <p className="data sms-m">{CALL.smsMeta}</p>
        </aside>
      </div>
    </section>
  );
}
