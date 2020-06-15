//@ts-check
"use strict"
const fs = require('fs');
const path = require('path');

// main.js
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const {
  Difficulty,
  PlayerType,
  Race,
} = require('@node-sc2/core/constants/enums');

const maps = require('./maps')

const eightGateAllIn = require('./builds/eight-gate-all-in');
const macro = require('./systems/macro');
const macroColossus = require('./builds/macro-colossus');
const protoss = require('./builds/protoss');
const protossSupplySystem = require('@node-sc2/system-protoss-supply');

const wallBuilderSystem = require('./systems/wall-builder-system');
const workerBalanceSystem = require('./systems/worker-balance-system');

const settings = {
  type: PlayerType.PARTICIPANT,
  race: Race.PROTOSS,
}

console.log('settings', settings);

const bot1 = createAgent(settings);
// const bot2 = createAgent(settings);
bot1.use(protoss);
// bot2.use(protoss);

const map = maps[Math.floor(Math.random() * maps.length)];
// bot1.use(eightGateAllIn);
// bot.use(macroColossus);
bot1.use(protossSupplySystem({
  firstPylon: {
    location: 'natural',
    supply: 14,
  }
}));
bot1.use(wallBuilderSystem);
bot1.use(workerBalanceSystem);

const engine = createEngine();
// const engine1 = createEngine(
//   { port: 5555 }
// );
// const engine2 = createEngine({ port: 5556 });

// engine1.connect().then(async () => {
//   console.log('bot1.settings', bot1.settings);
//   await engine.createGame(
//     map,
//     [
//       bot1.settings,
//       bot2.settings,
//     ]
//   )
//   await engine.joinGame(bot1, {
//     sharedPort: 5680,
//     serverPorts: {
//       gamePort: 5681,
//       basePort: 5682,
//     },
//     clientPorts: [{
//       gamePort: 5683,
//       basePort: 5684,
//     }, {
//       gamePort: 5685,
//       basePort: 5686
//     }]
//   });
//   engine1.runLoop()
// });

// async function connectToHost(engine, bot) {
//   return await engine.joinGame(bot, {
//     sharedPort: 5680,
//     serverPorts: {
//       gamePort: 5683,
//       basePort: 5684,
//     },
//     clientPorts: [{
//       gamePort: 5683,
//       basePort: 5684,
//     }, {
//       gamePort: 5685,
//       basePort: 5686
//     }, {
//       gamePort: 5687,
//       basePort: 5688,
//     }]
//   });
// }

// engine2.connect().then(async () => {
//   await connectToHost(engine2, bot2);
//   engine2.runLoop();
// });

engine.connect().then(async () => {
  console.log('map', map);
  return engine.runGame(
    map,
    [
      createPlayer({ race: Race.PROTOSS }, bot1),
      createPlayer({ race: Race.RANDOM, difficulty: Difficulty.CHEATMONEY }),
    ]
  );
}).then(async ([world, results]) => {
  console.log('GAME RESULTS: ', results);
  const { actions } = world.resources.get();

  const replay = await actions._client.saveReplay();
  fs.writeFileSync(path.join(__dirname, 'replays', `${Date.now()}.sc2replay`), replay.data);
}).catch(error => {
  console.log('connect error', error)
});