const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const HOURS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
] as const;
const TICKS: readonly (readonly [label: string, hour: number])[] = [
  ["12a", 0],
  ["6a", 6],
  ["12p", 12],
  ["6p", 18],
  ["12a", 24],
];

/** Open hours of the example shop: Monday to Friday, 8 a.m. to 6 p.m. (hours 8 through 17). */
export const isOpenHour = (day: number, hour: number): boolean =>
  day < 5 && hour >= 8 && hour <= 17;

/** The static week: 7 rows of 24 hairlines, 50 open (tall) and 118 closed (short). */
export function WeekGrid() {
  return (
    <div className="wk-static" aria-hidden="true">
      <div className="wk-axis">
        {TICKS.map(([label, hour]) => (
          <span
            key={`${label}-${hour}`}
            style={{ left: `${((hour / 24) * 100).toFixed(3)}%` }}
            className={hour === 0 ? "f" : hour === 24 ? "l" : ""}
          >
            {label}
          </span>
        ))}
      </div>
      {DAYS.map((day, d) => (
        <div className="wk-row" key={day}>
          <b>{day}</b>
          {HOURS.map((h) => (
            <i key={`${day}-${h}`} className={`c ${isOpenHour(d, h) ? "o" : "x"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
