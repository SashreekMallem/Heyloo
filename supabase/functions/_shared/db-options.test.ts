import { describe, expect, it } from "vitest";
import { buildConnectionOptions } from "./db-options.ts";

describe("buildConnectionOptions", () => {
  it("threads statementTimeoutMs through as a connection.statement_timeout GUC", () => {
    const opts = buildConnectionOptions({ statementTimeoutMs: 1_200 });
    expect(opts.connection).toEqual({ statement_timeout: 1_200 });
  });

  it("omits the connection key entirely when called with {}", () => {
    const opts = buildConnectionOptions({});
    expect(opts.connection).toBeUndefined();
    expect("connection" in opts).toBe(false);
  });

  it("omits the connection key entirely when called with undefined", () => {
    const opts = buildConnectionOptions(undefined);
    expect(opts.connection).toBeUndefined();
    expect("connection" in opts).toBe(false);
  });

  it("always sets the shared pool/prepare/timeout base options", () => {
    const withTimeout = buildConnectionOptions({ statementTimeoutMs: 500 });
    const without = buildConnectionOptions();
    for (const opts of [withTimeout, without]) {
      expect(opts.prepare).toBe(true);
      expect(opts.max).toBe(5);
      expect(opts.idle_timeout).toBe(20);
      expect(opts.connect_timeout).toBe(5);
    }
  });
});
