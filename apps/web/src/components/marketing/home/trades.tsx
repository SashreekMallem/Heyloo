import { TRADES, TRADES_COPY } from "@/content/marketing/home";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Chapter 5: eight kinds of business, each with its own first questions. */
export function Trades() {
  return (
    <section id="trades" data-ch="trades" aria-labelledby="trades-h">
      <div className="stage st-trades">
        <div className="tr-copy">
          <p className="lbl">{TRADES_COPY.label}</p>
          <h2 className="d2s kin kx" id="trades-h">
            {TRADES_COPY.title}
          </h2>
          <p className="lede">{TRADES_COPY.lede}</p>
          <ol className="tabs">
            {TRADES.map((trade, i) => (
              <li key={trade.id}>
                <a href={`#${trade.id}`}>
                  <span className="data">{pad(i + 1)}</span> {trade.name}
                </a>
              </li>
            ))}
          </ol>
        </div>
        <div className="tr-list">
          {TRADES.map((trade, i) => (
            <article
              className={i === 0 ? "trade on" : "trade"}
              id={trade.id}
              data-i={i}
              key={trade.id}
            >
              <p className="lbl idx">{pad(i + 1)} / 08</p>
              <div className="tr-head">
                <h3 className="nm kx">{trade.name}</h3>
                {trade.chip ? <span className="chip">{trade.chip}</span> : null}
              </div>
              <div className="tr-cols">
                <div>
                  <p className="lbl">{TRADES_COPY.asksLabel}</p>
                  <ul className="asks">
                    {trade.asks.map((ask) => (
                      <li key={ask}>{ask}</li>
                    ))}
                  </ul>
                </div>
                <div lang={trade.lang}>
                  <p className="lbl" lang="en">
                    {TRADES_COPY.exampleLabel}
                  </p>
                  <div className="ex">
                    {trade.example.map(([speaker, text]) => (
                      <p key={text}>
                        <span className="sp data" lang="en">
                          {speaker}
                        </span>
                        <span>{text}</span>
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="tr-foot">
          <p className="meter data">
            <span id="meter-n">01 / 08</span>
            <i className="mbar">
              <b id="meter-b" />
            </i>
          </p>
          <p className="data note">{TRADES_COPY.note}</p>
        </div>
      </div>
    </section>
  );
}
