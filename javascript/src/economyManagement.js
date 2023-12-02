//@ts-check
"use strict"

// economyManagement.js
const { WorkerRace, TownhallRace } = require("@node-sc2/core/constants/race-map");
const { UnitType } = require('@node-sc2/core/constants');
const { createUnitCommand, isSupplyNeeded, canBuild } = require('./utils');
const config = require("../config/config");
const { Race } = require("@node-sc2/core/constants/enums");
const BuildingPlacement = require("./buildingPlacement");
const groupTypes = require("@node-sc2/core/constants/groups");
const GameState = require("./gameState");
const { commandPlaceBuilding } = require("./builderUtils");
const MapResources = require("./mapResources");
const { getNextSafeExpansions } = require("./mapUtils");
const { morphStructureAction } = require("./constructionUtils");
const { addEarmark } = require("./resourceUtils");

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
 * @param {World} world
 * @param {Function} trainFunc
 * @returns {Promise<void>} 
 */
async function buildSupply(world, trainFunc) {
  const { OVERLORD, PYLON, SUPPLYDEPOT } = UnitType;
  const { agent } = world;
  const { foodUsed, minerals } = agent;
  if (foodUsed === undefined || minerals === undefined) return;

  const greaterThanPlanSupply = foodUsed > config.planMax.supply;
  const conditions = [
    isSupplyNeeded(world, 0.2) &&
    (greaterThanPlanSupply || minerals > 512) &&
    config.automateSupply,
  ];

  if (conditions.some(condition => condition)) {
    switch (agent.race) {
      case Race.TERRAN: {
        const candidatePositions = BuildingPlacement.findPlacements(world, SUPPLYDEPOT);
        await build(world, SUPPLYDEPOT, undefined, candidatePositions); // Use undefined instead of null
        break;
      }
      case Race.PROTOSS: {
        const candidatePositions = BuildingPlacement.findPlacements(world, PYLON);
        await build(world, PYLON, undefined, candidatePositions); // Use undefined instead of null
        break;
      }
      case Race.ZERG:
        await trainFunc(world, OVERLORD);
        break;
    }
  }
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {number} [targetCount=null]
 * @param {Point2D[]} [candidatePositions=[]]
 * @returns {Promise<void>}
 */
async function build(world, unitType, targetCount = undefined, candidatePositions = []) {
  const { addonTypes } = groupTypes;
  const { BARRACKS, ORBITALCOMMAND, GREATERSPIRE } = UnitType;
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];
  const { agent, data, resources } = world;
  const { actions, units } = resources.get();
  const gameState = new GameState();
  const effectiveTargetCount = targetCount === undefined ? Number.MAX_SAFE_INTEGER : targetCount;
  if (gameState.getUnitTypeCount(world, unitType) <= effectiveTargetCount &&
    gameState.getUnitCount(world, unitType) <= effectiveTargetCount) {
    const { race } = agent;
    switch (true) {
      case TownhallRace[race].includes(unitType):
        if (TownhallRace[race].indexOf(unitType) === 0) {
          if (units.getBases().length == 2 && agent.race === Race.TERRAN) {
            candidatePositions = await BuildingPlacement.getInTheMain(world, unitType);
            const position = BuildingPlacement.determineBuildingPosition(world, unitType, candidatePositions);
            if (position === false) {
              // If position is false, handle this as an error or a special case
              // For example, log an error, return, or take some other action
              console.error(`No valid position found for building type ${unitType}`);
              return;
            }

            collectedActions.push(...await commandPlaceBuilding(world, unitType, position));
          } else {
            const availableExpansions = MapResources.getAvailableExpansions(resources);
            const nextSafeExpansions = getNextSafeExpansions(world, availableExpansions);
            if (nextSafeExpansions.length > 0) {
              candidatePositions.push(nextSafeExpansions[0]);
              const position = BuildingPlacement.determineBuildingPosition(world, unitType, candidatePositions);

              if (position === false) {
                console.error(`No valid position found for building type ${unitType}`);
                return;
              }

              collectedActions.push(...await commandPlaceBuilding(world, unitType, position || null)); // Pass null if position is false
            }
          }
        } else {
          const unitTypeToCheckAfford = unitType === ORBITALCOMMAND ? BARRACKS : unitType;
          if (agent.canAfford(unitTypeToCheckAfford)) {
            collectedActions.push(...await morphStructureAction(world, unitType));
          }
          addEarmark(data, data.getUnitTypeData(unitType));
        }
        break;
      case addonTypes.includes(unitType):
        // ... (rest of the addonTypes case remains the same)
        break;
      default:
        if (unitType === GREATERSPIRE) {
          collectedActions.push(...await morphStructureAction(world, unitType));
        } else {
          const position = determineBuildingPosition(world, unitType, candidatePositions);
          collectedActions.push(...await commandPlaceBuilding(world, unitType, position));
        }
    }
  }
  if (collectedActions.length > 0) {
    const response = await actions.sendAction(collectedActions);
    if (response.result === undefined) return;
  }
}

module.exports = {
  trainWorker,
  buildSupply,
  build,
};
