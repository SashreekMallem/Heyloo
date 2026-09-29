import { SETUP } from "@/content/marketing/home";

/** Chapter 6: three setup steps. */
export function Setup() {
  return (
    <section id="setup" data-ch="setup" aria-labelledby="setup-h">
      <div className="stage st-setup">
        <div className="su-head">
          <p className="lbl">{SETUP.label}</p>
          <h2 className="d2s kin kx" id="setup-h">
            {SETUP.title}
          </h2>
          <p className="lede">{SETUP.lede}</p>
        </div>
        <ol className="steps">
          {SETUP.steps.map((step, i) => (
            <li className="step on" key={step.title}>
              <span className="stn kx" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <div className="vign panel">
                <span className="lbl ex-tag">{SETUP.exampleTag}</span>
                <dl>
                  {step.rows.map((row) => (
                    <div key={row[0]}>
                      <dt className="data">{row[0]}</dt>
                      <dd className={row[2] === "big" ? "big" : undefined}>{row[1]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          ))}
        </ol>
        <p className="live on">
          <i className="dot" aria-hidden="true" />
          <b>Live</b> {SETUP.live}
        </p>
      </div>
    </section>
  );
}
