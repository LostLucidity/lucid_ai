"use strict";

// Installed only for an explicitly configured smoke run. No process killing.
function installSmokeController(engine, seconds, report = console.log) {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0 || !String(seconds).trim()) {
    throw new Error('SC2_SMOKE_SECONDS must be a positive finite number');
  }
  const limit = Math.floor(duration * 22.4);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid smoke frame limit');
  const { frame, actions: { _client: client } } = engine.getWorld().resources.get();
  const original = { step: client.step, action: client.action, runLoop: engine.runLoop };
  let receipt = null;
  function stop(reason, detail = null) {
    if (receipt) return receipt;
    receipt = { mode: 'bounded_smoke', reason, gameLoop: frame.getGameLoop(), limit, detail };
    try { engine.shutdown(); } catch (error) { receipt.shutdownError = error.message; }
    report(JSON.stringify(receipt));
    return receipt;
  }
  function beforeActions() {
    if (!receipt && frame.getGameLoop() >= limit) stop('game_time_limit');
    return !receipt;
  }
  client.step = async function(request) {
    if (!beforeActions()) return {};
    return original.step.call(this, { ...request, count: Math.min(request.count, limit - frame.getGameLoop()) });
  };
  client.action = async function(request) {
    if (!beforeActions()) return { result: [] };
    try {
      const response = await original.action.call(this, request);
      if (response && response.result && response.result.some(result => result !== 1)) {
        stop('rejected_action', response.result);
      }
      return response;
    } catch (error) {
      stop('action_error', error.message);
      throw error;
    }
  };
  engine.runLoop = async function(...args) {
    if (!beforeActions()) return receipt;
    return original.runLoop.apply(this, args);
  };
  return {
    stop, beforeActions,
    get receipt() { return receipt; },
    restore() { client.step = original.step; client.action = original.action; engine.runLoop = original.runLoop; },
  };
}

module.exports = { installSmokeController };
