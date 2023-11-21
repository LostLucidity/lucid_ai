//@ts-check
"use strict"

const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const config = require('../config/config');
const GameState = require('./gameState');
const { logMessage, logError } = require('./logger');
const { WorkerRace, SupplyUnitRace } = require("@node-sc2/core/constants/race-map");
const { Race } = require('@node-sc2/core/constants/enums');
const { calculateDistance } = require('./utils');
const { UnitType } = require('@node-sc2/core/constants');
const { assignWorkers } = require('./workerAssignment');

// Instantiate the game state manager
const gameState = new GameState();

/** @type {number} Variable to store the bot's race */
let botRace;

/** @type {number} Track the total number of workers */
let totalWorkers = 0;

/** @type {number} Maximum number of workers */
let maxWorkers = 0;

/**
 * Attempts to find the enemy's base location.
 * @param {MapResource} map - The map resource object from the bot.
 * @param {Point2D} myBaseLocation - The bot's main base location.
 * @returns {Point2D | null} - The suspected enemy base location or null if not found.
 */
function findEnemyBase(map, myBaseLocation) {
  const possibleExpansions = map.getExpansions();
  let enemyBaseLocation = null;

  // Example: On a two-player map, the enemy base is typically the farthest expansion
  let maxDistance = 0;
  for (const expansion of possibleExpansions) {
    const distance = calculateDistance(expansion.townhallPosition, myBaseLocation);
    if (distance > maxDistance) {
      maxDistance = distance;
      enemyBaseLocation = expansion.townhallPosition;
    }
  }

  return enemyBaseLocation;
}

/**
 * Updates the maximum number of workers based on current game conditions.
 * @param {UnitResource} units - The units resource object from the bot.
 */
function updateMaxWorkers(units) {
  maxWorkers = calculateMaxWorkers(units);
}

/**
 * Balances the worker distribution across all bases.
 * @param {UnitResource} units - The units resource object from the bot.
 */
function balanceWorkerDistribution() {
  // Get all bases and their worker counts
  const bases = units.getBases();
  const workerCounts = bases.map(base => ({
    base: base,
    mineralWorkers: countMineralWorkers(base),
    gasWorkers: countGasWorkers(base),
    isSaturated: isBaseSaturated(base)
  }));

  // Logic to balance workers across bases
  // This may include transferring workers from saturated to unsaturated bases
  // And assigning workers to gas if needed
}

/**
 * Starts gas harvesting at the appropriate bases.
 * @param {UnitResource} units - The units resource object from the bot.
 */
function startGasHarvesting() {
  const bases = units.getBases();

  for (const base of bases) {
    // Check if gas geysers are available and no workers are assigned
    const gasGeysers = getGasGeysers(base);
    for (const geyser of gasGeysers) {
      if (geyser.assignedHarvesters === 0) {
        // Assign workers to gas geyser
        assignWorkersToGas(geyser);
      }
    }
  }
}

/**
 * Assigns workers to a gas geyser.
 * @param {Unit} geyser - The gas geyser unit.
 * @param {UnitResource} units - The units resource object from the bot.
 */
function assignWorkersToGas(geyser, units) {
  // ... implementation
}

/**
 * Calculates the maximum number of workers based on current game conditions.
 * @param {UnitResource} units - The units resource object from the bot.
 * @returns {number} - The calculated maximum number of workers.
 */
function calculateMaxWorkers(units) {
  const bases = units.getBases().length;
  return bases * 22; // Example: 22 workers per base
}

/**
 * Checks if a base is saturated with workers.
 * @param {Unit} base - The base to check for saturation.
 * @returns {boolean} - True if the base is saturated, false otherwise.
 */
function isBaseSaturated(base) {
  const idealHarvesters = base.idealHarvesters || 0;
  const assignedHarvesters = base.assignedHarvesters || 0;
  return assignedHarvesters >= idealHarvesters;
}

/**
 * @param {World} world 
 * @param {number} buffer 
 * @returns {boolean} 
 */
function isSupplyNeeded(world, buffer = 0) {
  const { agent, data, resources } = world;
  const { foodCap, foodUsed } = agent;
  const { units } = resources.get();
  const supplyUnitId = SupplyUnitRace[agent.race];
  const unitTypeData = data.getUnitTypeData(supplyUnitId);

  if (!unitTypeData || unitTypeData.abilityId === undefined || foodCap === undefined || foodUsed === undefined) {
    return false; // Skip logic if essential data is not available
  }

  const buildAbilityId = unitTypeData.abilityId;
  const pendingSupply = (
    (units.inProgress(supplyUnitId).length * 8) +
    (units.withCurrentOrders(buildAbilityId).length * 8)
  );
  const pendingSupplyCap = foodCap + pendingSupply;
  const supplyLeft = foodCap - foodUsed; // Now safe to use foodUsed
  const pendingSupplyLeft = supplyLeft + pendingSupply;
  const conditions = [
    pendingSupplyLeft < pendingSupplyCap * buffer,
    !(foodCap === 200),
  ];
  return conditions.every(c => c);
}

/**
 * @param {World} world 
 * @param {UnitTypeId} unitTypeId 
 * @returns {boolean}
 */
function canBuild(world, unitTypeId) {
  const { agent } = world;
  return agent.canAfford(unitTypeId) && agent.hasTechFor(unitTypeId) && (!isSupplyNeeded(world) || unitTypeId === UnitType.OVERLORD)
}

/**
 * Trains a worker at the specified base.
 * @param {World} world - The game world context.
 * @param {number} limit - The maximum number of workers to train.
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>} - The list of actions to train workers.
 */
async function trainWorker(world, limit = 1) {
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const workerTypeId = WorkerRace[agent.race];
  const collectedActions = [];

  if (canBuild(world, workerTypeId)) {
    const { abilityId, foodRequired } = data.getUnitTypeData(workerTypeId);
    if (abilityId === undefined || foodRequired === undefined) return collectedActions;

    let trainers = [];
    if (agent.race === Race.ZERG) {
      trainers = units.getById(UnitType.LARVA).filter(larva => !larva['pendingOrders'] || larva['pendingOrders'].length === 0);
    } else {
      trainers = units.getById(workerTypeId).filter(unit => unit.isIdle());
    }

    trainers = trainers.slice(0, limit);
    trainers.forEach(trainer => {
      const unitCommand = createUnitCommand(abilityId, [trainer]);
      collectedActions.push(unitCommand);
      // Logic to handle the pending orders and resource accounting
    });

    // Execute the actions
    // You need to implement logic to execute these collected actions
  }

  return collectedActions;
}

/**
 * Sends a worker to scout the enemy base.
 * @param {World} world - The game context, including resources and actions.
 */
async function performEarlyScouting(world) {
  const { units, actions, map } = world.resources.get();
  const workers = units.getMineralWorkers();
  const mainBaseLocation = map.getMain().townhallPosition;

  const scout = selectScout(workers, mainBaseLocation);
  if (scout) {
    const enemyBaseLocation = findEnemyBase(map, mainBaseLocation);
    if (enemyBaseLocation) {
      await actions.move(scout, enemyBaseLocation); // Send scout to enemy base
    }
  }
}

/**
 * Selects a suitable worker to perform scouting based on distance from the main base.
 * @param {Unit[]} workers - Array of worker units.
 * @param {Point2D} mainBaseLocation - Location of the main base.
 * @returns {Unit | null} - Selected scout or null if no suitable worker found.
 */
function selectScout(workers, mainBaseLocation) {
  if (workers.length === 0 || !mainBaseLocation) {
    return null;
  }

  let selectedScout = workers[0];
  let minDistance = calculateDistance(workers[0].pos, mainBaseLocation);

  for (const worker of workers) {
    const distance = calculateDistance(worker.pos, mainBaseLocation);
    if (distance < minDistance) {
      selectedScout = worker;
      minDistance = distance;
    }
  }

  return selectedScout;
}

// Create a new StarCraft II bot agent with event handlers.
const bot = createAgent({
  /**
   * Handler for game start events.
   * @param {World} world - The game context, including resources and actions.
   */
  async onGameStart(world) {
    logMessage('Game Started', 1);

    // Determine the bot's race at the start of the game
    botRace = (typeof world.agent.race !== 'undefined') ? world.agent.race : Race.TERRAN;

    // Retrieve initial units and resources
    const { units, actions } = world.resources.get();
    const workers = units.getWorkers();
    const mineralFields = units.getMineralFields();

    // Check if workers and mineral fields are available
    if (workers.length && mineralFields.length) {
      try {
        // Assign workers to mineral fields for initial resource gathering
        const workerActions = assignWorkers(world.resources);
        await actions.sendAction(workerActions);

        // Perform early game scouting
        await performEarlyScouting(world);
      } catch (error) {
        // Log any errors encountered during the initial setup
        logError('Error in assigning workers to minerals or scouting:', error);
      }
    } else {
      // Log an error if workers or mineral fields are undefined or empty
      logError('Error: Workers or mineral fields are undefined or empty');
    }
  },

  /**
   * Handler for each game step.
   * @param {World} world - The game context, including resources and actions.
   */
  async onStep(world) {
    const { units, actions } = world.resources.get();

    // Update the maximum number of workers based on the current game state
    updateMaxWorkers(units);

    // Balance worker distribution across all bases
    balanceWorkerDistribution(units);

    // Start or continue gas harvesting as necessary
    startGasHarvesting(units);

    // Check if more workers need to be trained based on the max worker count
    if (totalWorkers < maxWorkers) {
      const mainBases = units.getBases();
      for (const base of mainBases) {
        if (base.isIdle() && !isBaseSaturated(base)) {
          const workerType = WorkerRace[botRace];
          if (workerType) {
            const actionCommands = await trainWorker(world, 1);
            if (actionCommands.length > 0) {
              // Execute the actions through the action manager
              await actions.sendAction(actionCommands);
            }
          }
        }
      }
    }

    // TODO: Add additional logic here for continuous scouting, unit production,
    //       tech upgrades, and other strategic actions.

    // Example: Implement additional functions and logic for your bot's strategy
    // handleTechUpgrades(world);
    // executeCombatStrategies(world);
    // manageUnitProduction(world);
  },

  /**
   * Handler for game end events.
   */
  async onGameEnd() {
    logMessage('Game has ended', 1);
    gameState.reset();
  }
});

// Create the game engine
const engine = createEngine();

// Connect to the engine and run the game
engine.connect().then(() => {
  return engine.runGame(config.defaultMap, [
    createPlayer({ race: config.defaultRace }, bot),
    createPlayer({ race: config.defaultRace, difficulty: config.defaultDifficulty }),
  ]);
}).catch(err => {
  logError('Error in connecting to the engine or starting the game:', err);
});

module.exports = bot;
