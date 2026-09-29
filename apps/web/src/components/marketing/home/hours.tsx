import { HOURS } from "@/content/marketing/home";
import { WeekGrid } from "./week-grid";

/** Chapter 2: 168 hours in a week. The runtime drives the readout; the static grid is the fallback. */
export function Hours() {
  return (
    <section id="hours" data-ch="hours" aria-labelledby="hours-h">
      <div className="stage st-hours">
        <div className="hrs-copy">
          <div className="hrs-head">
            <p className="lbl">{HOURS.label}</p>
            <h2 className="d2s kin kx" id="hours-h">
              {HOURS.title}
            </h2>
          </div>
          <div className="hrs-body">
            <p className="lede">{HOURS.lede}</p>
            <div className="readout" id="readout">
              <p className="rd-time" id="rd-time">
                {HOURS.readoutTime}
              </p>
              <p className="rd-stat data">
                <span id="rd-stat">{HOURS.readoutStat}</span>{" "}
                <span className="chip" id="rd-tag" hidden>
                  {HOURS.readoutTag}
                </span>
              </p>
            </div>
            <ul className="legend data">
              <li>
                <i className="sw o" />
                {HOURS.legendOpen}
              </li>
              <li>
                <i className="sw x" />
                {HOURS.legendClosed}
              </li>
            </ul>
            <p className="data cap-note">{HOURS.note}</p>
            <p className="vh">{HOURS.srSummary}</p>
          </div>
        </div>
        <WeekGrid />
      </div>
    </section>
  );
}
