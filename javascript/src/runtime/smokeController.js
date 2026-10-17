"use strict";

// Installed only for an explicitly configured smoke run. No process killing.
function installSmokeController(engine, seconds, report = console.log, getReceiptDetails = () => ({})) {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0 || !String(seconds).trim()) {
    throw new Error('SC2_SMOKE_SECONDS must be a positive finite number');
  }
  const limit = Math.floor(duration * 22.4);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid smoke frame limit');
  const { frame, actions: { _client: client } } = engine.getWorld().resources.get();
  const original = { step: client.step, action: client.action, runLoop: engine.runLoop };
  const queue = client._promiseQueue;
  const pending = new Set();
  const requestTypes = new WeakMap();
  const stoppedError = Object.assign(new Error('Smoke run stopped'), { code: 'SC2_SMOKE_STOPPED' });
  let receipt = null;
  if (queue) {
    original.push = queue.push;
    original.request = client._request;
    queue.push = function(type, payload) {
      if (receipt) return Promise.reject(stoppedError);
      requestTypes.set(payload, type);
      const entry = { type };
      pending.add(entry);
      entry.promise = Promise.resolve().then(() => original.push.call(this, type, payload));
      // Observe settlement without hiding rejection from the request's caller.
      entry.promise.then(() => pending.delete(entry), () => pending.delete(entry));
      return entry.promise;
    };
    client._request = function(payload) {
      if (!receipt) return original.request.call(this, payload);
      // A queued request now starting already has protocol listeners installed.
      // Reject via that same channel so listeners and the queue are released.
      return client._protoApiQueue[requestTypes.get(payload)](stoppedError);
    };
  }
  function stop(reason, detail = null) {
    if (receipt) return receipt;
    let receiptDetails = {};
    try {
      const details = getReceiptDetails();
      if (details && typeof details === 'object' && !Array.isArray(details)) receiptDetails = details;
    } catch (error) {
      receiptDetails = { telemetryError: error instanceof Error ? error.message : String(error) };
    }
    receipt = { ...receiptDetails, mode: 'bounded_smoke', reason, gameLoop: frame.getGameLoop(), limit, detail };
    for (const type of new Set([...pending].map(entry => entry.type))) {
      client._protoApiQueue[type](stoppedError);
    }
    try { engine.shutdown(); } catch (error) { receipt.shutdownError = error.message; }
    report(JSON.stringify(receipt));
    return receipt;
  }
  function beforeActions() {
    if (!receipt && frame.getGameLoop() >= limit) stop('game_time_limit');
    return !receipt;
  }
  client.step = async function(request) {
    if (!beforeActions()) throw stoppedError;
    return original.step.call(this, { ...request, count: Math.min(request.count, limit - frame.getGameLoop()) });
  };
  client.action = async function(request) {
    if (!beforeActions()) throw stoppedError;
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
    async restore() {
      const restoreMethods = () => {
        client.step = original.step;
        client.action = original.action;
        engine.runLoop = original.runLoop;
        if (queue) { queue.push = original.push; client._request = original.request; }
      };
      // A failed request can start the next queued request in a later microtask.
      // Keep the guard until both the pending set and its handoff are quiescent.
      await Promise.resolve();
      while (pending.size) {
        await Promise.allSettled([...pending].map(entry => entry.promise));
        await Promise.resolve();
      }
      restoreMethods();
    },
  };
}

module.exports = { installSmokeController };
