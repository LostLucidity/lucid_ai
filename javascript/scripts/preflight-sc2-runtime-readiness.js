"use strict";

const findProcess = require("../src/runtime/windowsFindProcess");

const DEFAULT_ENGINE_PORT = 5000;
const SC2_PROCESS_NAME = "SC2_x64.exe";

function serializeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function preflightSc2RuntimeReadiness(
  processFinder = findProcess,
  enginePort = DEFAULT_ENGINE_PORT,
) {
  const [sc2Result, portResult] = await Promise.allSettled([
    processFinder("name", SC2_PROCESS_NAME, true),
    processFinder("port", enginePort),
  ]);
  const errors = [];
  const sc2Processes = sc2Result.status === "fulfilled" ? sc2Result.value : [];
  const portListeners = portResult.status === "fulfilled" ? portResult.value : [];

  if (sc2Result.status === "rejected") {
    errors.push({ check: "sc2_process", error: serializeError(sc2Result.reason) });
  }
  if (portResult.status === "rejected") {
    errors.push({ check: "engine_port", error: serializeError(portResult.reason) });
  }

  const blocked = errors.length > 0 || sc2Processes.length > 0 || portListeners.length > 0;
  return {
    mode: "read_only_sc2_runtime_readiness_preflight",
    enginePort,
    sc2ProcessName: SC2_PROCESS_NAME,
    status: errors.length > 0 ? "indeterminate" : blocked ? "blocked" : "ready",
    summary: {
      sc2ProcessCount: sc2Processes.length,
      portListenerCount: portListeners.length,
      ready: !blocked,
      canonicalWrites: 0,
      generatedWrites: 0,
    },
    sc2Processes,
    portListeners,
    errors,
  };
}

if (require.main === module) {
  preflightSc2RuntimeReadiness()
    .then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch(error => {
      console.error(`SC2 runtime readiness preflight failed: ${serializeError(error)}`);
      process.exitCode = 1;
    });
}

module.exports = { preflightSc2RuntimeReadiness };
