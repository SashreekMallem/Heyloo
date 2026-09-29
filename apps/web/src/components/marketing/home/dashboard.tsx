import { CALL_LINES, DASHBOARD } from "@/content/marketing/home";
import { waveformPath } from "./voice-model";

/** The example dashboard: real product UI drawn in the page's own type, never a screenshot. */
function ExampleDashboard() {
  const [first, second] = CALL_LINES;
  const lines = [first, second].flatMap((line) => (line ? [line] : []));
  return (
    <section className="dash panel" aria-label={DASHBOARD.frameLabel} data-focus="booking">
      <div className="d-top">
        <span className="d-wm kx">Heyloo</span>
        <span className="d-tabs">
          <span className="on" aria-current="page">
            Calls
          </span>
          <span>Bookings</span>
          <span>Messages</span>
        </span>
        <span className="d-biz">Riverside Auto Repair</span>
        <span className="d-badge">Example</span>
      </div>
      <div className="d-body">
        <ol className="d-rail">
          {DASHBOARD.rail.map((row) => (
            <li className={row.on ? "on" : undefined} key={row.when}>
              <span className="data">{row.when}</span>
              <b>{row.who}</b>
              <span className="chips">
                {row.chips.map((chip) => (
                  <span className="chip" key={chip}>
                    {chip}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
        <div className="d-detail">
          <div className="d-head">
            <p className="d-name">M. Alvarez</p>
            <span className="chips">
              <span className="chip">Booked</span>
              <span className="chip">New caller</span>
            </span>
            <p className="data d-meta">{DASHBOARD.detailMeta}</p>
          </div>
          <div className="d-blocks">
            <div className="blk" data-block="transcript">
              <p className="lbl">Transcript</p>
              {lines.map((line) => (
                <p className="dl" key={line.t0}>
                  <b className="who data">{line.speaker === "ava" ? "Ava" : "Caller"}</b>
                  {line.text}
                </p>
              ))}
            </div>
            <div className="blk" data-block="recording">
              <p className="lbl">Recording</p>
              <span className="player" role="img" aria-label="Example recording player, 0:58">
                <svg className="play" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />
                </svg>
                <svg
                  className="wave"
                  viewBox="0 0 192 32"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d={waveformPath()} />
                </svg>
                <span className="data pt">0:58</span>
              </span>
            </div>
            <div className="blk" data-block="summary">
              <p className="lbl">Summary</p>
              <p className="sum">{DASHBOARD.summary}</p>
            </div>
            <div className="blk" data-block="booking">
              <p className="lbl">Booking</p>
              <div className="bk">
                <dl>
                  {DASHBOARD.booking.map(([term, value]) => (
                    <div key={term}>
                      <dt className="data">{term}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="day" aria-hidden="true">
                  <b className="data">Wed</b>
                  {DASHBOARD.day.map((slot) => (
                    <i
                      className={slot === "10:30 AM" ? "data slot" : "data"}
                      data-ember={slot === "10:30 AM" ? "" : undefined}
                      key={slot}
                    >
                      {slot}
                    </i>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Chapter 4: the next morning, the whole call in the dashboard. */
export function Dashboard() {
  return (
    <section id="dashboard" data-ch="dash" aria-labelledby="dash-h">
      <div className="stage st-dash">
        <div className="dash-copy">
          <p className="lbl">{DASHBOARD.label}</p>
          <h2 className="d2s kin kx" id="dash-h">
            {DASHBOARD.title}
          </h2>
          <ul className="words">
            {DASHBOARD.words.map((word, i) => (
              <li className={i === 0 ? "word on" : "word"} data-k={word.key} key={word.key}>
                <h3 className="nm kx">{word.name}</h3>
                <p>{word.body}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="dash-wrap">
          <p className="lbl">{DASHBOARD.frameLabel}</p>
          <div id="dash-slot">
            <ExampleDashboard />
          </div>
        </div>
      </div>
    </section>
  );
}
