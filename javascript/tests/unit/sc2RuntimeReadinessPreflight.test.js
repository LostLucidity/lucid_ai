const {
  preflightSc2RuntimeReadiness,
} = require("../../scripts/preflight-sc2-runtime-readiness");

describe("SC2 runtime readiness preflight", () => {
  it("reports ready when SC2 is absent and port 5000 has no listener", async () => {
    const calls = [];
    const processFinder = async (...args) => {
      calls.push(args);
      return [];
    };

    const report = await preflightSc2RuntimeReadiness(processFinder);

    expect(report.status).toBe("ready");
    expect(report.summary).toEqual({
      sc2ProcessCount: 0,
      portListenerCount: 0,
      ready: true,
      canonicalWrites: 0,
      generatedWrites: 0,
    });
    expect(calls).toEqual([
      ["name", "SC2_x64.exe", true],
      ["port", 5000],
    ]);
  });

  it("blocks when SC2 is running or the engine port is occupied", async () => {
    const processFinder = async by => by === "name"
      ? [{ name: "SC2_x64.exe", pid: 1234 }]
      : [{ pid: 5678 }];

    const report = await preflightSc2RuntimeReadiness(processFinder);

    expect(report.status).toBe("blocked");
    expect(report.summary.ready).toBe(false);
    expect(report.sc2Processes).toEqual([{ name: "SC2_x64.exe", pid: 1234 }]);
    expect(report.portListeners).toEqual([{ pid: 5678 }]);
  });

  it("fails closed when process inspection is unavailable", async () => {
    const processFinder = async by => {
      if (by === "name") throw new Error("tasklist unavailable");
      return [];
    };

    const report = await preflightSc2RuntimeReadiness(processFinder);

    expect(report.status).toBe("indeterminate");
    expect(report.summary.ready).toBe(false);
    expect(report.errors).toEqual([
      { check: "sc2_process", error: "tasklist unavailable" },
    ]);
  });
});
