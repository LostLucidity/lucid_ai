//@ts-check
"use strict"
const fs = require('fs');
const path = require('path');

// main.js
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const {
  AIBuild,
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
const boGeneratorSystem = require('./systems/bo-generator-system');
const scoutingSystem = require('./systems/scouting/scouting-system');
const taggingSystem = require('./systems/tagging-system');
const { logoutStepsExecuted } = require('./services/logging-service');
const { saveReplay, saveExecutedStepsLog } = require('./services/file-saving-service');
const agentService = require('./services/agent-service');
const mulingSystem = require('./systems/muling-system');
const wallOffNaturalSystem = require('./systems/wall-off-natural/wall-off-natural-system');
const unitResourceSystem = require('./systems/unit-resource/unit-resource-system');
const { saveUnitTypeData } = require('./filesystem');
const unitResourceService = require('./systems/unit-resource/unit-resource-service');
const detectUpgradeSystem = require('./systems/detect-upgrade-system');
const setRallySystem = require('./systems/set-rally-system');
const attackSystem = require('./systems/army-management/attack-system');
const injectorSystem = require('./systems/injector-system');
const { saveBuildOrder } = require('./services/world-service');

agentService.difficulty = Difficulty.VERYHARD;
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

async function runGame() {
  console.log('__dirname', __dirname);
  // console.log(path.join(__dirname, 'data', `current.json`));
  const map = maps[Math.floor(Math.random() * maps.length)];
  // const map = 'Submarine506';
  console.log('map', map);
  const aiBuild = AIBuild.Rush;
  const settings = {
    type: PlayerType.PARTICIPANT,
    race: Race.TERRAN,
  }
  const opponentRace = Race.TERRAN;
  /** @type {EventReader<AgentObject>} */
  const blueprint = {
    settings,
    interface: {
      raw: true,
      rawCropToPlayableArea: true,
      score: true,
      showBurrowedShadows: true,
      showCloaked: true
    }
  }
  console.log('blueprint', blueprint);
  const bot1 = createAgent(blueprint);
  const legacySystems = [
    workerTrainingSystem,
    trackUnitsSystem,
    scoutingSystem,
    loggingSystem,
    wallOffNaturalSystem,
    entry,
    workerBalanceSystem,
    enemyTrackingSystem,
    debugSystem,
    wallOffRampSystem,
    taggingSystem,
    unitResourceSystem,
    detectUpgradeSystem,
    swapBuildingSystem,
  ];
  const updatedSystems = [
    saltConverterSystem,
    wallOffRampSystem,
    scoutingSystem,
    workerTrainingSystem,
    unitTrainingSystem,
    executePlanSystem,
    workerBalanceSystem,
    runBehaviorsSystem,
    // defenseSystem,
    enemyTrackingSystem,
    rallySystem,
    manageSupplySystem,
    trackUnitsSystem,
    swapBuildingSystem,
    liftToThirdSystem,
    debugSystem,
    loggingSystem,
    mulingSystem,
    setRallySystem,
    unitResourceSystem,
  ];
  const bogSystems = [
    boGeneratorSystem,
    loggingSystem,
    workerBalanceSystem,
    attackSystem,
    manageSupplySystem,
    injectorSystem,
    workerTrainingSystem,
    runBehaviorsSystem,
    wallOffRampSystem,
  ];
  bot1.use(legacySystems);
  // bot1.use(updatedSystems);
  // bot1.use(bogSystems);
  const playerOne = createPlayer({ race: settings.race }, bot1);
  const playerTwo = createPlayer({ race: opponentRace, difficulty: agentService.difficulty, aiBuild: aiBuild });
  const players = [playerOne, playerTwo];
  const player = players.find(p => !!p.agent);
  player.agent.settings.race = player.race;
  const realTime = false;
  const randomSeed = 2;
  await engine.createGame(map, players, realTime, randomSeed);
  return engine.joinGame(player.agent);
}

async function processResults([{ agent, data, resources }, gameResults]) {
/**
 * @param {GameResult} gameResult 
 */
async function processResults(gameResult) {
  const [world, gameResults] = gameResult;
  console.log('GAME RESULTS: ', gameResults);
  logoutStepsExecuted();
  const { agent, resources } = world;
  const { actions, frame } = resources.get();
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
  saveUnitTypeData(unitResourceService.unitTypeData);
  saveExecutedStepsLog(agent, frame.getGameInfo().mapName);
  const selfResult = gameResults.find(result => result.playerId === agent.playerId);
  saveBuildOrder(world, selfResult);
  const replay = await actions._client.saveReplay();
  saveReplay(replay);
  actions._client.close();
}
