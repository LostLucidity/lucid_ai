"use strict";

const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
let connectCalls = 0;
let runGameCalls = 0;
let runGameArguments;

Module._load = function loadWithOfflineEngine(request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);

  if (request !== '@node-sc2/core') {
    return loaded;
  }

  return {
    ...loaded,
    createEngine: () => ({
      connect: async () => {
        connectCalls += 1;
      },
      runGame: async (...args) => {
        runGameCalls += 1;
        runGameArguments = args;
        return { offline: true };
      },
    }),
  };
};

async function validateEntrypoint() {
  const bot = require('../main');
  const config = require('../config/config');

  assert.strictEqual(typeof bot.run, 'function', 'main.js must export a run function');
  assert.strictEqual(connectCalls, 0, 'requiring main.js must not connect to StarCraft II');

  if (process.platform === 'win32') {
    assert.strictEqual(
      require('find-process'),
      require('../src/runtime/windowsFindProcess'),
      'the Windows entrypoint must install the WMIC-free process finder'
    );
  }

  const result = await bot.run();

  assert.strictEqual(connectCalls, 1, 'run() must connect exactly once');
  assert.strictEqual(runGameCalls, 1, 'run() must start exactly one game');
  assert.strictEqual(runGameArguments.length, 2, 'runGame() must receive map and players');
  assert.strictEqual(
    runGameArguments[0],
    config.defaultMap,
    'runGame() must use the configured map'
  );
  assert.strictEqual(runGameArguments[1].length, 2, 'runGame() must receive two players');
  assert.deepStrictEqual(result, { offline: true });

  console.log('Entrypoint smoke check passed without contacting StarCraft II.');
}

validateEntrypoint().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
