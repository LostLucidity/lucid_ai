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

const maps = require('./maps');

const workerBalanceSystem = require('./systems/worker-balance-system');
const entry = require('./builds/entry');
const { getFileName } = require('./helper/get-races');
const saltConverterSystem = require('./systems/salt-converter/salt-converter-system');
const executePlanSystem = require('./systems/execute-plan/execute-plan-system');
const unitTrainingSystem = require('./systems/unit-training/unit-training-system');
const workerTrainingSystem = require('./systems/worker-training-system');
const wallOffRampSystem = require('./systems/wall-off-ramp/wall-off-ramp-system');
const workerScoutingSystem = require('./systems/scouting/worker-scouting-system');
const runBehaviorsSystem = require('./systems/run-behaviors-system');
const enemyTrackingSystem = require('./systems/enemy-tracking/enemy-tracking-system');
const rallySystem = require('./systems/army-management/rally-system');
const defenseSystem = require('./systems/army-management/defense-system');
const manageSupplySystem = require('./systems/manage-supply-system');
const debugSystem = require('./systems/debug-system');
const trackUnitsSystem = require('./systems/track-units/track-units-system');
const swapBuildingSystem = require('./systems/swap-building-system');
const liftToThirdSystem = require('./systems/lift-to-third-system');
const loggingSystem = require('./systems/logging-system');

const difficulty = Difficulty.VERYHARD;
// const aiBuild = AIBuild.Rush;
// const bot2 = createAgent(settings);
// protossBuild.forEach(system => {
//   bot1.use(system);
// });
// loadBuilds(Race.PROTOSS, protossBuilds.protoss, bot1);
// loadBuilds(Race.TERRAN, terranBuilds, bot1);
// loadBuilds(Race.ZERG, zergBuilds, bot1);
// function loadBuilds(race, builds, bot) {
//   settings.race = race;
//   builds.forEach(build => {
//     bot.use(build);
//   });
// }

// bot1.use(zerg);
// bot2.use(protoss);
// bot1.use(eightGateAllIn);
// bot.use(macroColossus);

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
let gameLimit = 1;

try {
  (async () => {
    const responsePing = await engineConnect();
    console.log('responsePing', responsePing);
    for (let game = 0; game < gameLimit; game++) {
      console.log('game', game + 1)
      const gameResults = await runGame();
      await processResults(gameResults);
    }
    console.log('end loop');
  })();
} catch (error) {
  console.log('connect error', error.message);
}

function engineConnect() {
  return engine.connect();
}

function runGame() {
  console.log('__dirname', __dirname);
  console.log(path.join(__dirname, 'data', `current.json`));
  // const map = maps[Math.floor(Math.random() * maps.length)];
  const map = 'Submarine506';
  console.log('map', map);
  const aiBuild = 2;
  const settings = {
    type: PlayerType.PARTICIPANT,
    race: Race.ZERG,
  }
  const opponentRace = Race.ZERG;
  const blueprint = {
    settings,
    interface: {
      raw: true,
      rawCropToPlayableArea: true,
      showBurrowedShadows: true,
      showCloaked: true
    }
  }
  console.log('blueprint', blueprint);
  const bot1 = createAgent(blueprint);
  const legacySystems = [
    entry,
    workerBalanceSystem,
    enemyTrackingSystem,
    trackUnitsSystem,
    debugSystem,
    loggingSystem,
  ];
  const updatedSystems = [
    saltConverterSystem,
    wallOffRampSystem,
    workerTrainingSystem,
    unitTrainingSystem,
    executePlanSystem,
    workerBalanceSystem,
    workerScoutingSystem,
    runBehaviorsSystem,
    defenseSystem,
    enemyTrackingSystem,
    rallySystem,
    manageSupplySystem,
    trackUnitsSystem,
    swapBuildingSystem,
    liftToThirdSystem,
    debugSystem,
  ];
  bot1.use(legacySystems);
  const playerOne = createPlayer({ race: settings.race }, bot1);
  const playerTwo = createPlayer({ race: opponentRace, difficulty: difficulty, ai_build: aiBuild })
  return engine.runGame(map, [playerOne, playerTwo]);
}

async function processResults([{ agent, data, resources }, gameResults]) {
  console.log('GAME RESULTS: ', gameResults);
  const { actions } = resources.get();
  const parsedCompositions = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', `current.json`)).toString())
  parsedCompositions.forEach(composition => {
    if (typeof composition.attack !== 'undefined') {
      composition.matches++
      if (gameResults.find(result => result.playerId === agent.playerId).result === 1) {
        composition.attack ? composition.differential++ : composition.differential--;
      } else {
        composition.attack ? composition.differential-- : composition.differential++;
      }
      delete composition.attack;
    }
  });
  const [selfUnitType] = Object.keys(parsedCompositions[0].selfComposition);
  const [enemyUnitType] = Object.keys(parsedCompositions[0].enemyComposition);
  fs.writeFileSync(path.join(__dirname, 'data', getFileName(data, selfUnitType, enemyUnitType)), JSON.stringify(parsedCompositions));
  const replay = await actions._client.saveReplay();
  fs.writeFileSync(path.join(__dirname, 'replays', `${Date.now()}.sc2replay`), replay.data);
}