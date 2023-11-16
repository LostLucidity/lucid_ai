//@ts-check
"use strict";

const groupTypes = require("@node-sc2/core/constants/groups");
const unitService = require("../../../services/unit-service");
const { Ability, UnitTypeId, UnitType, UpgradeId } = require("@node-sc2/core/constants");
const { getDistance } = require("../../../services/position-service");
const { getAddOnBuildingPosition, getAddOnBuildingPlacement } = require("../../../helper/placement/placement-utilities");
const { checkUnitCount } = require("../unit-analysis");
const { unpauseAndLog, setAndLogExecutedSteps } = require("../shared-functions");
const getRandom = require("@node-sc2/core/utils/get-random");
const UnitAbilityMap = require("@node-sc2/core/constants/unit-ability-map");
const { Alliance, Race, Attribute } = require("@node-sc2/core/constants/enums");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { pointsOverlap, shuffle } = require("../../../helper/utilities");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const unitResourceService = require("../../../systems/unit-resource/unit-resource-service");
const { countTypes } = require("../../../helper/groups");
const { isTrainingUnit } = require("../../../services/data-service");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const dataService = require("../../../services/data-service");
const { createUnitCommand } = require("../../shared-utilities/command-utilities");
const worldService = require("../../world-service");
const unitTrainingService = require("../../../systems/unit-training/unit-training-service");
const { addEarmark, getTimeToTargetCost, getTimeToTargetTech } = require("../../shared-utilities/common-utilities");
const planService = require("../../../services/plan-service");
const { trainWorkers } = require("../economy-management/economy-management-service");
const { checkTechFor } = require("../../../services/agent-service");
const { setFoodUsed } = require("../../shared-utilities/data-utils");
const { getFoodUsed } = require("../../shared-utilities/info-utils");
const { train } = require("../../shared-utilities/training-utilities");
const { canBuild, getTrainer } = require("../../shared-utilities/training-shared-utils");
const { buildSupply } = require("../../shared-utilities/supply-utils");
const { warpInSync } = require("../unit-commands/warp-in-commands");
const unitRetrievalService = require("../unit-retrieval");
const loggingService = require("../../logging/logging-service");
const { isStrongerAtPosition } = require("../combat-shared/combat-evaluation-service");
const serviceLocator = require("../service-locator");

/** @type {import("../../services/army-management/army-management-service")} */
const armyManagementService = serviceLocator.get('armyManagementService');

// Main Functions
/**
   * @description build supply or train units
   * @param {World} world
   * @param {import("../../../interfaces/plan-step").PlanStep} step
   * @returns {Promise<void>}
   */
async function buildSupplyOrTrain(world, step) {
  const { agent, data, resources } = world;
  const { actions } = resources.get();

  let foodUsed = getFoodUsed() + dataService.getEarmarkedFood();
  const foodUsedLessThanNextStepFoodTarget = step && foodUsed < step.food;

  if (!step || foodUsedLessThanNextStepFoodTarget) {
    await buildSupply(world, train);

    let trainingOrders = trainWorkers(world, buildWorkers);
    if (trainingOrders.length === 0) {
      trainingOrders = trainCombatUnits(world);
    }

    if (trainingOrders.length > 0) {
      await actions.sendAction(trainingOrders);
    } else {
      // get food difference
      foodUsed = getFoodUsed() + dataService.getEarmarkedFood();
      const foodDifference = step ? step.food - foodUsed : 0;

      // add earmark for food difference
      for (let i = 0; i < foodDifference; i++) {
        addEarmark(data, data.getUnitTypeData(WorkerRace[agent.race]));
      }
    }
  }
  setFoodUsed(world);
}

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
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function trainCombatUnits(world) {
  const { OVERLORD } = UnitType;
  const { checkProductionAvailability } = worldService;
  const { agent, data, resources } = world;
  const { minerals, vespene } = agent; if (minerals === undefined || vespene === undefined) return [];
  const { units } = resources.get();
  const collectedActions = [];
  const { planMin, trainingTypes, unitMax } = planService;
  const { getExistingTrainingTypes } = unitResourceService;
  const { selectTypeToBuild } = worldService;
  const { currentStep, plan, legacyPlan } = planService;
  const plannedTrainingTypes = trainingTypes.length > 0 ? trainingTypes : getExistingTrainingTypes(units);
  const candidateTypesToBuild = plannedTrainingTypes.filter(type => {
    const { attributes, foodRequired } = data.getUnitTypeData(type); if (attributes === undefined || foodRequired === undefined) return false;
    const food = plan[currentStep] ? plan[currentStep].food : legacyPlan[currentStep][0];
    if (
      (!attributes.includes(Attribute.STRUCTURE) && type !== OVERLORD) &&
      foodRequired <= food - getFoodUsed() &&
      (
        armyManagementService.outpowered ? armyManagementService.outpowered : planMin[UnitTypeId[type]] <= getFoodUsed()
      ) &&
      (
        !unitMax[UnitTypeId[type]] || (unitRetrievalService.getUnitTypeCount(world, type) < unitMax[UnitTypeId[type]])
      ) &&
      checkTechFor(agent, type) &&
      checkProductionAvailability(world, type)
    ) {
      return true;
    }
  });
  if (candidateTypesToBuild.length > 0) {
    let { selectedTypeToBuild } = unitTrainingService;
    selectedTypeToBuild = selectedTypeToBuild ? selectedTypeToBuild : selectTypeToBuild(world, candidateTypesToBuild);
    if (selectedTypeToBuild !== undefined && selectedTypeToBuild !== null) {
      if (armyManagementService.outpowered || agent.canAfford(selectedTypeToBuild)) {
        collectedActions.push(...trainSync(world, selectedTypeToBuild));
      }
    }
    unitTrainingService.selectedTypeToBuild = selectedTypeToBuild;
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

/**
 * @param {World} world 
 * @param {number} upgradeId 
 */
async function upgrade(world, upgradeId) {
  const { getPendingOrders } = unitService;
  const { BARRACKS, TECHLAB } = UnitType;
  const { techLabTypes } = groupTypes
  const { agent, data, resources } = world;
  const { upgradeIds } = agent; if (upgradeIds === undefined) return;
  const { actions, frame, units } = resources.get();
  if (upgradeIds.includes(upgradeId)) return;
  const upgraders = units.getUpgradeFacilities(upgradeId).filter(upgrader => upgrader.alliance === Alliance.SELF);
  const upgradeData = data.getUpgradeData(upgradeId);
  const { abilityId } = upgradeData; if (abilityId === undefined) return;
  const upgradeInProgress = upgraders.find(upgrader => upgrader.orders && upgrader.orders.find(order => order.abilityId === abilityId));
  if (upgradeInProgress) return;
  if (agent.canAffordUpgrade(upgradeId)) {
    const upgrader = getRandom(upgraders.filter(upgrader => {
      return upgrader.noQueue && upgrader.abilityAvailable(abilityId);
    }));
    if (upgrader) {
      const unitCommand = createUnitCommand(abilityId, [upgrader]);
      await actions.sendAction([unitCommand]);
      unitService.setPendingOrders(upgrader, unitCommand);
      setAndLogExecutedSteps(world, frame.timeInSeconds(), UpgradeId[upgradeId], loggingService, armyManagementService);
    } else {
      const techLabRequired = techLabTypes.some(techLabType => UnitAbilityMap[techLabType].some(ability => ability === abilityId));
      if (techLabRequired) {
        const techLabs = units.getAlive(Alliance.SELF).filter(unit => techLabTypes.includes(unit.unitType));
        const orphanTechLabs = techLabs.filter(techLab => {
          const { pos } = techLab; if (pos === undefined) return false;
          const footprint = getFootprint(BARRACKS); if (footprint === undefined) return false;
          return techLab.unitType === TECHLAB && !pointsOverlap(cellsInFootprint(getAddOnBuildingPlacement(pos), footprint), unitResourceService.landingGrids);
        });
        if (orphanTechLabs.length > 0) {
          // get completed and idle barracks
          let completedBarracks = units.getById(countTypes.get(BARRACKS)).filter(barracks => barracks.buildProgress >= 1);
          let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);
          // if no idle barracks, get closest barracks to tech lab.
          const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => isTrainingUnit(data, barracks) && barracks.orders[0].progress <= 0.5);
          if (barracks.length > 0) {
            let closestPair = [];
            barracks.forEach(barracks => {
              orphanTechLabs.forEach(techLab => {
                const addOnBuildingPosition = getAddOnBuildingPosition(techLab.pos);
                if (closestPair.length > 0) {
                  closestPair = getDistance(barracks.pos, addOnBuildingPosition) < getDistance(closestPair[0].pos, closestPair[1]) ? [barracks, addOnBuildingPosition] : closestPair;
                } else { closestPair = [barracks, addOnBuildingPosition]; }
              });
            });
            if (closestPair.length > 0) {
              // if barracks is training unit, cancel training.
              if (isTrainingUnit(data, closestPair[0])) {
                // for each training unit, cancel training.
                for (let i = 0; i < closestPair[0].orders.length; i++) {
                  await actions.sendAction(createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair[0]]));
                  unitService.setPendingOrders(closestPair[0], createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair[0]]));
                }
              }
              // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
              const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
              const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
              const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);
              const distance = getDistance(closestPair[0].pos, closestPair[1]);
              const { movementSpeed } = data.getUnitTypeData(UnitType.BARRACKSFLYING); if (movementSpeed === undefined) return;
              const movementSpeedPerSecond = movementSpeed * 1.4;
              const timeToMove = distance / movementSpeedPerSecond + (unitService.liftAndLandingTime * 2);
              if (timeUntilUpgradeCanStart < timeToMove) {
                const label = 'reposition';
                closestPair[0].labels.set(label, closestPair[1]);
              }
            }
          }
        } else {
          const nonOrphanTechLabs = techLabs.filter(techLab => techLab.unitType !== TECHLAB);
          // find idle building with tech lab.
          const idleBuildingsWithTechLab = nonOrphanTechLabs
            .map(techLab => units.getClosest(getAddOnBuildingPosition(techLab.pos), units.getAlive(Alliance.SELF), 1)[0])
            .filter(building => building.noQueue && getPendingOrders(building).length === 0);
          // find closest barracks to closest tech lab.
          /** @type {Unit[]} */
          let closestPair = [];
          // get completed and idle barracks.
          let completedBarracks = units.getById(countTypes.get(BARRACKS)).filter(barracks => barracks.buildProgress >= 1);
          let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);
          // if no idle barracks, get closest barracks to tech lab.
          const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => isTrainingUnit(data, barracks) && barracks.orders[0].progress <= 0.5);
          if (barracks.length > 0 && idleBuildingsWithTechLab.length > 0) {
            barracks.forEach(barracks => {
              idleBuildingsWithTechLab.forEach(idleBuildingsWithtechLab => {
                if (closestPair.length > 0) {
                  closestPair = getDistance(barracks.pos, idleBuildingsWithtechLab.pos) < getDistance(closestPair[0].pos, closestPair[1].pos) ? [barracks, idleBuildingsWithtechLab] : closestPair;
                } else { closestPair = [barracks, idleBuildingsWithtechLab]; }
              });
            });
          }
          if (closestPair.length > 0) {
            const { pos: pos0, orders: orders0 } = closestPair[0]; if (pos0 === undefined || orders0 === undefined) return;
            const { pos: pos1 } = closestPair[1]; if (pos1 === undefined) return;
            // if barracks is training unit, cancel training.
            // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
            const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
            const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
            const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);
            const distance = getDistance(pos1, pos0);
            if (distance > 0) {
              const { movementSpeed } = data.getUnitTypeData(UnitType.BARRACKSFLYING); if (movementSpeed === undefined) return;
              const movementSpeedPerSecond = movementSpeed * 1.4;
              const timeToMove = distance / movementSpeedPerSecond + (64 / 22.4);
              if (timeUntilUpgradeCanStart < timeToMove) {
                if (isTrainingUnit(data, closestPair[0])) {
                  for (let i = 0; i < orders0.length; i++) {
                    await actions.sendAction(createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair[0]]));
                    unitService.setPendingOrders(closestPair[0], createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair[0]]));
                  }
                } else {
                  const label = 'reposition';
                  closestPair[0].labels.set(label, closestPair[1].pos);
                  closestPair[1].labels.set(label, 'lift');
                }
              }
            }
          }
        }
      }
    }
  } else {
    const techLabRequired = techLabTypes.some(techLabType => UnitAbilityMap[techLabType].some(ability => ability === abilityId));
    if (techLabRequired) {
      const techLabs = units.getAlive(Alliance.SELF).filter(unit => techLabTypes.includes(unit.unitType));
      const orphanTechLabs = techLabs.filter(techLab => {
        const { pos } = techLab; if (pos === undefined) return false;
        const footprint = getFootprint(BARRACKS); if (footprint === undefined) return false;
        return techLab.unitType === TECHLAB && !pointsOverlap(cellsInFootprint(getAddOnBuildingPlacement(pos), footprint), unitResourceService.landingGrids);
      });
      if (orphanTechLabs.length > 0) {
        // get completed and idle barracks
        let completedBarracks = units.getById(countTypes.get(UnitType.BARRACKS)).filter(barracks => barracks.buildProgress >= 1);
        let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);

        // if no idle barracks, get closest barracks to tech lab.
        const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => isTrainingUnit(data, barracks) && barracks.orders[0].progress <= 0.5);

        if (barracks.length > 0) {
          let closestPair = [];
          barracks.forEach(barracks => {
            orphanTechLabs.forEach(techLab => {
              const addOnBuildingPosition = getAddOnBuildingPosition(techLab.pos);
              if (closestPair.length > 0) {
                closestPair = getDistance(barracks.pos, addOnBuildingPosition) < getDistance(closestPair[0].pos, closestPair[1]) ? [barracks, addOnBuildingPosition] : closestPair;
              } else { closestPair = [barracks, addOnBuildingPosition]; }
            });
          });
          if (closestPair.length > 0) {
            // if barracks is training unit, cancel training.
            if (isTrainingUnit(data, closestPair[0])) {
              // for each training unit, cancel training.
              for (let i = 0; i < closestPair[0].orders.length; i++) {
                await actions.sendAction(createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair[0]]));
                unitService.setPendingOrders(closestPair[0], createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair[0]]));
              }
            }
            // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
            const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
            const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
            const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);
            const distance = getDistance(closestPair[0].pos, closestPair[1]);
            const { movementSpeed } = data.getUnitTypeData(UnitType.BARRACKSFLYING); if (movementSpeed === undefined) return;
            const movementSpeedPerSecond = movementSpeed * 1.4;
            const timeToMove = distance / movementSpeedPerSecond + (unitService.liftAndLandingTime * 2);
            if (timeUntilUpgradeCanStart < timeToMove) {
              const label = 'reposition';
              closestPair[0].labels.set(label, closestPair[1]);
            }
          }
        }
      } else {
        const nonOrphanTechLabs = techLabs.filter(techLab => techLab.unitType !== TECHLAB);
        // find idle building with tech lab.
        const idleBuildingsWithTechLab = nonOrphanTechLabs
          .map(techLab => units.getClosest(getAddOnBuildingPosition(techLab.pos), units.getAlive(Alliance.SELF), 1)[0])
          .filter(building => building.noQueue && getPendingOrders(building).length === 0);
        // find closest barracks to closest tech lab.
        /** @type {Unit[]} */
        let closestPair = [];
        // get completed and idle barracks.
        let completedBarracks = units.getById(countTypes.get(BARRACKS)).filter(barracks => barracks.buildProgress >= 1);
        let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);
        // if no idle barracks, get closest barracks to tech lab.
        const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => isTrainingUnit(data, barracks) && barracks.orders[0].progress <= 0.5);
        if (barracks.length > 0 && idleBuildingsWithTechLab.length > 0) {
          barracks.forEach(barracks => {
            idleBuildingsWithTechLab.forEach(idleBuildingsWithtechLab => {
              if (closestPair.length > 0) {
                closestPair = getDistance(barracks.pos, idleBuildingsWithtechLab.pos) < getDistance(closestPair[0].pos, closestPair[1].pos) ? [barracks, idleBuildingsWithtechLab] : closestPair;
              } else { closestPair = [barracks, idleBuildingsWithtechLab]; }
              if (frame.timeInSeconds() >= 329 && resources.get().frame.timeInSeconds() <= 354) {
                console.log(`Closest pair currently: [${closestPair[0].pos}, ${closestPair[1].pos}]`);
              }
            });
          });
        }
        if (closestPair.length > 0) {
          const { pos: pos0, orders: orders0 } = closestPair[0]; if (pos0 === undefined || orders0 === undefined) return;
          const { pos: pos1 } = closestPair[1]; if (pos1 === undefined) return;
          // if barracks is training unit, cancel training.
          // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
          const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
          const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
          const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);
          const distance = getDistance(pos1, pos0);
          if (distance > 0) {
            const { movementSpeed } = data.getUnitTypeData(UnitType.BARRACKSFLYING); if (movementSpeed === undefined) return;
            const movementSpeedPerSecond = movementSpeed * 1.4;
            const timeToMove = distance / movementSpeedPerSecond + (64 / 22.4);
            if (timeUntilUpgradeCanStart < timeToMove) {
              if (isTrainingUnit(data, closestPair[0])) {
                for (let i = 0; i < orders0.length; i++) {
                  const response = await actions.sendAction(createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair[0]]));
                  if (response.result && response.result.find(x => x !== 1)) {
                    console.log('Error cancelling queue');
                  }
                  unitService.setPendingOrders(closestPair[0], createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair[0]]));
                }
              } else {
                const label = 'reposition';
                closestPair[0].labels.set(label, closestPair[1].pos);
                closestPair[1].labels.set(label, 'lift');
              }
            }
          }
        }
      }
    }
  }
  addEarmark(data, upgradeData);
}

// Exports
module.exports = {
  buildSupplyOrTrain,
  buildWorkers,
  trainCombatUnits,
  trainSync,
  upgrade,
};