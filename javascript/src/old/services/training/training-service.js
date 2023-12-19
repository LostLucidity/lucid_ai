//@ts-check
"use strict";

const groupTypes = require("@node-sc2/core/constants/groups");
const { Ability, UnitTypeId, UnitType, UpgradeId } = require("@node-sc2/core/constants");
const { checkUnitCount } = require("../unit-analysis");
const { setAndLogExecutedSteps } = require("../shared-functions");
const getRandom = require("@node-sc2/core/utils/get-random");
const UnitAbilityMap = require("@node-sc2/core/constants/unit-ability-map");
const { Alliance, Race, Attribute } = require("@node-sc2/core/constants/enums");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const worldService = require("../../world-service");
const { trainWorkers } = require("../economy-management/economy-management-service");
const { canBuild, getTrainer } = require("../../shared-utilities/training-shared-utils");
const { warpInSync } = require("../unit-commands/warp-in-commands");
const unitRetrievalService = require("../unit-retrieval");
const loggingService = require("../../logging/logging-service");
const serviceLocator = require("../service-locator");

/** @type {import("../../services/army-management/army-management-service")} */
const armyManagementService = serviceLocator.get('armyManagementService');

/**
 * @param {World} world 
 * @param {number} limit
 * @param {boolean} checkCanBuild
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function buildWorkers(world, limit = 1, checkCanBuild = false) {
  const { agent, data, resources } = world;
  const { race } = agent;
  const { units } = resources.get();
  const { setPendingOrders } = unitService;
  const { getIdleOrAlmostIdleUnits } = worldService;
  const collectedActions = [];
  const workerTypeId = WorkerRace[agent.race];

  if (canBuild(world, workerTypeId) || checkCanBuild) {
    const { abilityId, foodRequired } = data.getUnitTypeData(workerTypeId);
    if (abilityId === undefined || foodRequired === undefined) return collectedActions;

    let trainers = [];
    if (agent.race === Race.ZERG) {
      trainers = units.getById(UnitType.LARVA).filter(larva => !larva['pendingOrders'] || larva['pendingOrders'].length === 0);
    } else {
      trainers = getIdleOrAlmostIdleUnits(world, WorkerRace[race]);
    }

    trainers = trainers.reduce((/** @type {Unit[]} */acc, trainer) => {
      if (trainer.pos) { // Ensure trainer has a position
        const point2D = { x: trainer.pos.x, y: trainer.pos.y }; // Convert to Point2D or use type assertion
        if (isStrongerAtPosition(world, point2D)) {
          acc.push(trainer);
        }
      }
      return acc;
    }, []);
    if (trainers.length > 0) {
      trainers = shuffle(trainers);
      trainers = trainers.slice(0, limit);
      trainers.forEach(trainer => {
        const unitCommand = createUnitCommand(abilityId, [trainer]);
        collectedActions.push(unitCommand);
        setPendingOrders(trainer, unitCommand);
        planService.pendingFood += foodRequired;
      });
      return collectedActions;
    }
  }

  return collectedActions;
}

/**
 * @param {World} world 
 * @param {UnitTypeId} unitTypeId 
 * @param {number | null} targetCount
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function trainSync(world, unitTypeId, targetCount = null) {
  const { setPendingOrders } = unitService;
  const { WARPGATE } = UnitType;
  const { data } = world;
  const collectedActions = [];

  let { abilityId } = data.getUnitTypeData(unitTypeId);
  if (abilityId === undefined) return collectedActions;

  if (checkUnitCount(world, unitTypeId, targetCount) || targetCount === null) {
    const trainers = getTrainer(world, unitTypeId);

    // Filter trainers based on strength at their position.
    const safeTrainers = trainers.filter(trainer => {
      if (trainer.pos) {
        return isStrongerAtPosition(world, trainer.pos);
      }
      return false;
    });

    // Use a random safe trainer instead of any random trainer.
    const randomSafeTrainer = getRandom(safeTrainers);

    if (randomSafeTrainer) {
      if (canBuild(world, unitTypeId) && randomSafeTrainer) {
        if (randomSafeTrainer.unitType !== WARPGATE) {
          const unitCommand = createUnitCommand(abilityId, [randomSafeTrainer]);
          collectedActions.push(unitCommand);
          setPendingOrders(randomSafeTrainer, unitCommand);
          unpauseAndLog(world, UnitTypeId[unitTypeId], loggingService);
        } else {
          collectedActions.push(...warpInSync(world, unitTypeId));
          unpauseAndLog(world, UnitTypeId[unitTypeId], loggingService);
        }
        addEarmark(data, data.getUnitTypeData(unitTypeId));
        console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitTypeId)}`);
        unitTrainingService.selectedTypeToBuild = null;
      } else {
        addEarmark(data, data.getUnitTypeData(unitTypeId));
      }
    }
  }
  return collectedActions;
}

// Exports
module.exports = {
  buildSupplyOrTrain,
  buildWorkers,
  trainSync,
};