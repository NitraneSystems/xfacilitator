import { describe, expect, it } from "vitest";
import { classifyHttpOutcome } from "./classify.js";

describe("classifyHttpOutcome", () => {
  it("network_error when networkError flag set", () => {
    expect(
      classifyHttpOutcome({
        statusCode: 200,
        latencyMs: 10,
        latencyThresholdMs: 100,
        networkError: true,
      }),
    ).toBe("network_error");
  });

  it("network_error when statusCode null", () => {
    expect(
      classifyHttpOutcome({
        statusCode: null,
        latencyMs: 10,
        latencyThresholdMs: 100,
      }),
    ).toBe("network_error");
  });

  it("network_error when statusCode 0", () => {
    expect(
      classifyHttpOutcome({
        statusCode: 0,
        latencyMs: 10,
        latencyThresholdMs: 100,
      }),
    ).toBe("network_error");
  });

  it("server_error for 5xx", () => {
    expect(
      classifyHttpOutcome({
        statusCode: 503,
        latencyMs: 10,
        latencyThresholdMs: 100,
      }),
    ).toBe("server_error");
  });

  it("client_error for 4xx", () => {
    expect(
      classifyHttpOutcome({
        statusCode: 429,
        latencyMs: 10,
        latencyThresholdMs: 100,
      }),
    ).toBe("client_error");
  });

  it("slow for 2xx over threshold", () => {
    expect(
      classifyHttpOutcome({
        statusCode: 200,
        latencyMs: 101,
        latencyThresholdMs: 100,
      }),
    ).toBe("slow");
  });

  it("success for 2xx within threshold", () => {
    expect(
      classifyHttpOutcome({
        statusCode: 200,
        latencyMs: 100,
        latencyThresholdMs: 100,
      }),
    ).toBe("success");
  });

  it("other for 3xx", () => {
    expect(
      classifyHttpOutcome({
        statusCode: 301,
        latencyMs: 10,
        latencyThresholdMs: 100,
      }),
    ).toBe("other");
  });
});
