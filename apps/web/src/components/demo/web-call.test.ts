import { describe, expect, it } from "vitest";
import { parseWebCall } from "./web-call";

describe("parseWebCall", () => {
  it("maps the gateway fields create-web-call returns", () => {
    expect(
      parseWebCall({
        call_id: "call_1",
        transport: "gateway",
        ice_servers: [
          { urls: ["stun:a.example:3478"] },
          { urls: "turn:b.example", username: "u", credential: "c" },
        ],
      }),
    ).toEqual({
      callId: "call_1",
      transport: "gateway",
      iceServers: [
        { urls: ["stun:a.example:3478"] },
        { urls: "turn:b.example", username: "u", credential: "c" },
      ],
    });
  });

  it("drops what it does not recognise and returns undefined when nothing is left", () => {
    expect(
      parseWebCall({ transport: "carrier-pigeon", call_id: 7, ice_servers: [{ urls: 3 }, 5] }),
    ).toBeUndefined();
    expect(parseWebCall(null)).toBeUndefined();
    expect(parseWebCall("gateway")).toBeUndefined();
  });
});
