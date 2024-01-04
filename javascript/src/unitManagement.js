//@ts-check
"use strict";

// External library imports
const { UnitType, Ability, WarpUnitAbility } = require("@node-sc2/core/constants");
const { Alliance, Attribute, Race } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");
const { WorkerRace, GasMineRace } = require("@node-sc2/core/constants/race-map");
const UnitAbilityMap = require("@node-sc2/core/constants/unit-ability-map");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const getRandom = require("@node-sc2/core/utils/get-random");

// Internal dependencies
const BuildingPlacement = require("./buildingPlacement");
const { buildSupply } = require("./buildingService");
const { getTimeToTargetTech } = require("./gameData");
const { missingUnits } = require("./gameDataStore");
const GameState = require("./gameState");
const { getById } = require("./gameUtils");
const { getDistance } = require("./geometryUtils");
const { pointsOverlap } = require("./mapUtils");
const { getAddOnBuildingPlacement, landingGrids } = require("./placementUtils");
const { haveSupplyForUnit, getTimeToTargetCost } = require("./resourceManagement");
const { addEarmark, getEarmarkedFood } = require("./resourceUtils");
const { mappedEnemyUnits } = require("./scoutingUtils");
const { earmarkResourcesIfNeeded } = require("./sharedEconomicFunctions");
const { getBuildTimeLeft } = require("./sharedUtils");
const StrategyManager = require("./strategyManager");
const { flyingTypesMapping, unitTypeTrainingAbilities, liftAndLandingTime } = require("./unitConfig");
const { getUnitTypeCount, potentialCombatants, calculateTimeToKillUnits, isTrainingUnit } = require("./unitHelpers");
const { setPendingOrders } = require("./unitOrders");
const { createUnitCommand, findKeysForValue, canBuild } = require("./utils");
const { getPendingOrders } = require("./utils/commonGameUtils");
const { shortOnWorkers } = require("./workerUtils");

/** @type {Map<UnitTypeId, Unit[]>} */
const productionUnitsCache = new Map();

/** @type {boolean} */
let unitProductionAvailable = true;

/**
 * @description build supply or train units
 * @param {World} world
 * @param {import("./strategyService").PlanStep} step
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function buildSupplyOrTrain(world, step) {
  const { agent, data } = world;

  let collectedActions = [];
  const gameState = GameState.getInstance();
  let foodUsed = gameState.getFoodUsed() + getEarmarkedFood();
  const foodUsedLessThanNextStepFoodTarget = step && foodUsed < step.food;

  if (!step || foodUsedLessThanNextStepFoodTarget) {
    if (agent.race === Race.ZERG) {
      const zergSupplyActions = manageZergSupply(world);
      collectedActions.push(...zergSupplyActions);
    } else {
      let supplyActions = buildSupply(world);
      collectedActions.push(...supplyActions);
    }

    let trainingOrders = shouldTrainWorkers(world) ? trainWorkersDirectly(world) : [];
    if (trainingOrders.length === 0) {
      trainingOrders = trainCombatUnits(world);
    }
    collectedActions.push(...trainingOrders);

    if (trainingOrders.length === 0) {
      foodUsed = gameState.getFoodUsed() + getEarmarkedFood();
      const foodDifference = step ? step.food - foodUsed : 0;

      if (agent.race !== undefined && WorkerRace[agent.race]) { // Check if agent.race is defined
        for (let i = 0; i < foodDifference; i++) {
          addEarmark(data, data.getUnitTypeData(WorkerRace[agent.race]));
        }
      }
    }
  }

  gameState.setFoodUsed(world);

  return collectedActions;
}

/**
 * Check if unit can train now.
 * @param {World} world
 * @param {Unit} unit 
 * @param {UnitTypeId} unitType
 * @returns {boolean}
 */
const canTrainNow = (world, unit, unitType) => {
  const { data, resources } = world;
  const { orders } = unit;
  if (orders === undefined || unit.buildProgress === undefined) return false;
  const allOrders = orders.filter(order => {
    const { abilityId, progress } = order; if (abilityId === undefined || progress === undefined) return false;
    const unitType = unitTypeTrainingAbilities.get(abilityId); if (unitType === undefined) return false;
    const { buildTime } = data.getUnitTypeData(unitType); if (buildTime === undefined) return false;
    const buildTimeLeft = getBuildTimeLeft(unit, buildTime, progress);
    return buildTimeLeft > 8;
  });
  const currentAndPendingOrders = allOrders.concat(getPendingOrders(unit));
  const maxOrders = unit.hasReactor() ? 2 : 1;
  const conditions = [currentAndPendingOrders.length < maxOrders];
  const { techRequirement } = data.getUnitTypeData(unitType);
  if (techRequirement) {
    if (techRequirement === UnitType.TECHLAB) {
      conditions.push(unit.hasTechLab());
    } else {
      conditions.push(
        getById(resources, [techRequirement]).some(unit => {
          return unit.buildProgress !== undefined && unit.buildProgress >= 1;
        })
      );
    }
  }
  return conditions.every(condition => condition);
};

/**
 * @param {World} world
 * @param {number} unitType
 */
function checkProductionAvailability(world, unitType) {
  const gameState = GameState.getInstance();
  if (gameState.availableProductionUnits.has(unitType)) {
    return gameState.availableProductionUnits.get(unitType) || false;
  }
  const haveAvailableProductionUnits = haveAvailableProductionUnitsFor(world, unitType);
  gameState.availableProductionUnits.set(unitType, haveAvailableProductionUnits);
  return haveAvailableProductionUnits;
}

/**
 * Analyzes the game state and determines if the current count of a 
 * specific unit type matches the target count.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {number} targetCount
 * @returns {boolean}
 */
function checkUnitCount(world, unitType, targetCount) {
  const { data, resources } = world;
  const { units } = resources.get();
  const orders = [];
  /** @type {UnitTypeId[]} */
  let unitTypes = []; // Assign an empty array as default

  const gameState = GameState.getInstance();
  if (gameState.morphMapping?.has(unitType)) {
    const mappingValue = gameState.morphMapping.get(unitType);
    if (mappingValue) {
      unitTypes = mappingValue;
    }
  } else {
    unitTypes = [unitType];
  }
  let abilityId = data.getUnitTypeData(unitType).abilityId;

  if (typeof abilityId === 'undefined') {
    // Ability ID for the unit type is not defined, so return false
    return false;
  }
  units.withCurrentOrders(abilityId).forEach(unit => {
    if (unit.orders) {
      unit.orders.forEach(order => {
        if (order.abilityId === abilityId) {
          // Check if the unitType is zergling and account for the pair
          const orderCount = (unitType === UnitType.ZERGLING) ? 2 : 1;
          for (let i = 0; i < orderCount; i++) {
            orders.push(order);
          }
        }
      });
    }
  });

  const unitsWithPendingOrders = units.getAlive(Alliance.SELF).filter(u => {
    const unitPendingOrders = getPendingOrders(u);
    return unitPendingOrders && unitPendingOrders.some(o => o.abilityId === abilityId);
  });

  let adjustedTargetCount = targetCount;
  if (unitType === UnitType.ZERGLING) {
    const existingZerglings = getById(resources, [UnitType.ZERGLING]).length;
    const oddZergling = existingZerglings % 2;
    adjustedTargetCount += oddZergling;
  }

  const unitCount = getById(resources, unitTypes).length + orders.length + unitsWithPendingOrders.length + missingUnits.filter(unit => unit.unitType === unitType).length;

  return unitCount === adjustedTargetCount;
}

/**
 * @param {UnitResource} units
 * @returns {UnitTypeId[]}
 */
function getExistingTrainingTypes(units) {
  return units.getAlive().reduce((/** @type {UnitTypeId[]} */ types, unit) => {
    const { unitType } = unit; if (unitType === undefined) { return types; }
    if (types.includes(unitType)) {
      return types;
    }
    return [...types, unitType];
  }, []);
}

/**
 * Calculates the difference in food supply needed for the next step of the build plan.
 * @param {World} world
 * @returns {number}
 */
function getFoodDifference(world) {
  const { agent, data } = world;
  const race = agent.race;

  // Check if race is defined
  if (race === undefined || !WorkerRace[race]) {
    return 0; // Return early or handle the undefined case
  }

  const workerRaceData = WorkerRace[race]; // Cache the value
  const { abilityId } = data.getUnitTypeData(workerRaceData);
  if (abilityId === undefined) {
    return 0;
  }

  const gameState = GameState.getInstance();
  const foodUsed = gameState.getFoodUsed();

  const strategyManager = StrategyManager.getInstance();
  const plan = strategyManager.getCurrentStrategy();

  // Check if plan is defined
  if (!plan) {
    console.error('Current strategy plan is undefined.');
    return 0;
  }

  const step = plan.steps.find(step => parseInt(step.supply, 10) > foodUsed);
  const foodDifference = step ? parseInt(step.supply, 10) - foodUsed : 0;
  const productionUnitsCount = getProductionUnits(world, workerRaceData).length;
  const lowerOfFoodDifferenceAndProductionUnitsCount = Math.min(foodDifference, productionUnitsCount);

  let affordableFoodDifference = 0;
  for (let i = 0; i < lowerOfFoodDifferenceAndProductionUnitsCount; i++) {
    if (agent.canAfford(workerRaceData) && haveSupplyForUnit(world, workerRaceData)) {
      affordableFoodDifference++;
      addEarmark(data, data.getUnitTypeData(workerRaceData))
    } else {
      break;
    }
  }
  return affordableFoodDifference;
}


/**
 * Retrieves units capable of producing a specific unit type.
 * @param {World} world
 * @param {UnitTypeId} unitTypeId
 * @returns {Unit[]}
 */
function getProductionUnits(world, unitTypeId) {
  const { units } = world.resources.get();
  // Check if the result is in the cache
  if (productionUnitsCache.has(unitTypeId)) {
    return productionUnitsCache.get(unitTypeId) || [];
  }

  const { abilityId } = world.data.getUnitTypeData(unitTypeId); if (abilityId === undefined) return [];
  let producerUnitTypeIds = world.data.findUnitTypesWithAbility(abilityId);

  if (producerUnitTypeIds.length <= 0) {
    const alias = world.data.getAbilityData(abilityId).remapsToAbilityId; if (alias === undefined) return [];
    producerUnitTypeIds = world.data.findUnitTypesWithAbility(alias);
  }

  const result = units.getByType(producerUnitTypeIds);

  // Store the result in the cache
  productionUnitsCache.set(unitTypeId, result);

  return result;
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitTypeId
 * @returns {Unit[]}
 */
function getTrainer(world, unitTypeId) {
  const { WARPGATE } = UnitType;
  const { data, resources } = world;
  const { units } = resources.get();
  let { abilityId } = data.getUnitTypeData(unitTypeId); if (abilityId === undefined) return [];

  const unitFilter = (/** @type {Unit} */ unit) => {
    const { orders } = unit;
    const pendingOrders = getPendingOrders(unit);
    if (abilityId === undefined || orders === undefined || pendingOrders === undefined) return false;
    const allOrders = [...orders, ...pendingOrders];
    const spaceToTrain = allOrders.length === 0 || (unit.hasReactor() && allOrders.length < 2);
    return spaceToTrain && unit.abilityAvailable(abilityId) && !unit.labels.has('reposition');
  };

  let productionUnits = getProductionUnits(world, unitTypeId).filter(unitFilter);

  if (productionUnits.length === 0) {
    const abilityId = WarpUnitAbility[unitTypeId];
    productionUnits = units.getById(WARPGATE).filter(warpgate => abilityId && warpgate.abilityAvailable(abilityId));
  }

  // Check for flying units
  const unitTypesWithAbility = data.findUnitTypesWithAbility(abilityId);
  const flyingTypes = unitTypesWithAbility.flatMap(value => findKeysForValue(flyingTypesMapping, value));
  const flyingUnits = units.getById(flyingTypes).filter(unit => unit.isIdle());

  productionUnits = [...productionUnits, ...flyingUnits];

  return productionUnits;
}

/**
 * Check if unitType has prerequisites to build when minerals are available.
 * @param {World} world 
 * @param {UnitTypeId} unitType 
 * @returns {boolean}
 */
function haveAvailableProductionUnitsFor(world, unitType) {
  const { resources } = world;
  const { units } = resources.get();
  const warpInAbilityId = WarpUnitAbility[unitType];
  const productionUnits = getProductionUnits(world, unitType);
  return (
    units.getById(UnitType.WARPGATE).some(warpgate => warpgate.abilityAvailable(warpInAbilityId)) ||
    productionUnits.some(unit =>
      unit.buildProgress !== undefined &&
      unit.buildProgress >= 1 &&
      !unit.isEnemy() &&
      canTrainNow(world, unit, unitType)
    )
  );
}

/**
 * Checks if the player's units are stronger at a specific position compared to enemy units.
 *
 * @param {World} world - The current game world state.
 * @param {Point2D} position - The position to check.
 * @returns {boolean} - Returns true if the player's units are stronger at the given position, otherwise false.
 */
function isStrongerAtPosition(world, position) {
  const { units } = world.resources.get();

  /**
   * Retrieves units within a specified radius from a position.
   * @param {Unit[]} unitArray - Array of units.
   * @param {number} rad - Radius to filter units by.
   * @returns {Unit[]} - Units within the specified radius.
   */
  const getUnitsInRadius = (unitArray, rad) =>
    unitArray.filter(unit => unit.pos && getDistance(unit.pos, position) < rad);

  let enemyUnits = getUnitsInRadius(mappedEnemyUnits, 16).filter(potentialCombatants);

  // If there's only one enemy and it's a non-combatant worker, disregard it
  if (enemyUnits.length === 1 && !potentialCombatants(enemyUnits[0])) {
    enemyUnits = [];
  }

  // If no potential enemy combatants, player is stronger by default
  if (!enemyUnits.length) return true;

  const selfUnits = getUnitsInRadius(units.getAlive(Alliance.SELF), 16).filter(potentialCombatants);
  return shouldEngage(world, selfUnits, enemyUnits);
}

/**
 * Manages Zerg supply by training Overlords as needed.
 * @param {World} world - The current game world context.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - Commands to train Overlords, if needed.
 */
function manageZergSupply(world) {
  const { agent, data, resources } = world;
  const { foodCap, foodUsed } = agent;
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const actions = [];

  if (foodCap !== undefined && foodUsed !== undefined && (foodCap - foodUsed < 8) && agent.canAfford(UnitType.OVERLORD)) {
    const overlordData = data.getUnitTypeData(UnitType.OVERLORD);
    if (overlordData && overlordData.abilityId !== undefined) {
      const larva = resources.get().units.getById(UnitType.LARVA);
      const abilityId = overlordData.abilityId; // Define abilityId here
      larva.forEach(larvaUnit => {
        if (larvaUnit.isIdle() && abilityId !== undefined) {
          // Ensure abilityId is defined before calling createUnitCommand
          const unitCommand = createUnitCommand(abilityId, [larvaUnit]);
          actions.push(unitCommand);
        }
      });
    }
  }

  return actions;
}

/**
 * Clears the production units cache.
 */
function refreshProductionUnitsCache() {
  productionUnitsCache.clear();
}

/**
 * Determines if a group of selfUnits should engage against a group of enemyUnits.
 * @param {World} world
 * @param {Unit[]} selfUnits
 * @param {Unit[]} enemyUnits
 * @returns {boolean}
 */
function shouldEngage(world, selfUnits, enemyUnits) {
  if (selfUnits.length === 0 && enemyUnits.length === 0) {
    // Modify this return value or add logic as per your game's requirements
    return true; // or false, or any other handling you find appropriate
  }

  const { timeToKill, timeToBeKilled } = calculateTimeToKillUnits(world, selfUnits, enemyUnits);

  // Engage if self units can eliminate enemy units faster than they can be eliminated
  return timeToKill <= timeToBeKilled;
}

/**
 * Analyzes the game state and decides if workers should be trained.
 * @param {World} world - The current game world context.
 * @returns {boolean} - True if conditions are met for training workers, false otherwise.
 */
function shouldTrainWorkers(world) {
  const { agent: { minerals, race }, resources } = world;

  // Check if race and minerals are defined
  if (race === undefined || minerals === undefined) {
    return false; // Exit the function if race or minerals are undefined
  }

  const workerRaceData = WorkerRace[race]; // Cache the worker race data
  const workerCount = getById(resources, [workerRaceData]).length;
  const gasMineRaceData = GasMineRace[race]; // Cache the gas mine race data
  const assignedWorkerCount = [...resources.get().units.getBases(), ...getById(resources, [gasMineRaceData])]
    .reduce((acc, base) => (base.assignedHarvesters || 0) + acc, 0);
  const minimumWorkerCount = Math.min(workerCount, assignedWorkerCount);
  const foodDifference = getFoodDifference(world);
  const sufficientMinerals = minerals < 512 || minimumWorkerCount <= 36;
  const productionPossible = haveAvailableProductionUnitsFor(world, workerRaceData);
  const strategyManager = StrategyManager.getInstance();
  const notOutpoweredOrNoUnits = !strategyManager.getOutpowered() || (strategyManager.getOutpowered() && !unitProductionAvailable);

  return sufficientMinerals && (shortOnWorkers(world) || foodDifference > 0)
    && notOutpoweredOrNoUnits && productionPossible;
}

/**
 * Train a unit.
 * @param {World} world The current game world.
 * @param {UnitTypeId} unitTypeId Type of the unit to train.
 * @param {number | null} targetCount Target number of units.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function train(world, unitTypeId, targetCount = null) {
  const {
    agent, data, resources
  } = world;

  const { reactorTypes, techLabTypes } = groupTypes;
  const { units } = resources.get();
  const unitTypeData = data.getUnitTypeData(unitTypeId);
  const { abilityId } = unitTypeData;

  if (abilityId === undefined) return [];
  const currentUnitTypeCount = getUnitTypeCount(world, unitTypeId);
  let earmarkNeeded = targetCount && currentUnitTypeCount < targetCount;

  const collectedActions = [];

  const setRepositionLabel = (/** @type {Unit} */ unit, /** @type {Point2D} */ position) => {
    unit.labels.set('reposition', position);
    console.log('reposition', position);
  };

  const handleNonWarpgateTrainer = (/** @type {Unit} */ trainer) => {
    const actions = [];

    if (trainer.isFlying) {
      const landingPosition = BuildingPlacement.checkAddOnPlacement(world, trainer);
      if (landingPosition) {
        setRepositionLabel(trainer, landingPosition);
        const landCommand = createUnitCommand(Ability.LAND, [trainer], false, landingPosition);
        actions.push(landCommand);
      }
    } else {
      const trainCommand = createUnitCommand(abilityId, [trainer]);
      actions.push(trainCommand);
    }

    return actions;
  };

  const selectRandomUnit = (/** @type {Unit[]} */ unitList) => unitList[Math.floor(Math.random() * unitList.length)];

  const handleTechRequirements = (/** @type {Unit} */ unit, /** @type {number} */ techRequirement) => {
    if (!techRequirement) return;

    const matchingAddOnTypes = techLabTypes.includes(techRequirement)
      ? techLabTypes
      : reactorTypes.includes(techRequirement)
        ? reactorTypes
        : [techRequirement];

    const techLabUnits = units.getById(matchingAddOnTypes).filter(unit => unit.unitType !== techRequirement);

    if (techLabUnits.length > 0) {
      const techLab = techLabUnits.reduce((closestTechLab, techLab) => {
        const techLabPos = techLab.pos;
        if (!techLabPos) {
          return closestTechLab;  // return the current closestTechLab if techLabPos is undefined
        }

        const closestTechLabPos = closestTechLab.pos;
        if (!closestTechLabPos) {
          return closestTechLab;  // return the current closestTechLab if closestTechLabPos is undefined
        }

        if (!unit.pos) {
          return closestTechLab;  // return the current closestTechLab if unit.pos is undefined
        }

        return getDistance(techLabPos, unit.pos) < getDistance(closestTechLabPos, unit.pos)
          ? techLab
          : closestTechLab;
      }, techLabUnits[0]);

      if (techLab) {
        const techLabPosition = techLab.pos;
        if (techLabPosition) {
          const addOnBuildingPosition = BuildingPlacement.getAddOnBuildingPosition(techLabPosition);
          if (addOnBuildingPosition) {
            const [currentBuilding] = units.getClosest(addOnBuildingPosition, units.getStructures().filter(structure => structure.addOnTag === techLab.tag && structure.buildProgress === 1));
            if (currentBuilding) {
              unit.labels.set('reposition', BuildingPlacement.getAddOnBuildingPosition(techLabPosition));
              const [addOnBuilding] = units.getClosest(addOnBuildingPosition, units.getStructures().filter(structure => structure.addOnTag === techLab.tag));
              if (addOnBuilding) {
                addOnBuilding.labels.set('reposition', 'lift');
              }
            }
          }
        }
      }
    }
  };

  const handleUnitBuilding = (/** @type {Unit} */ unit) => {
    const { requireAttached, techRequirement } = unitTypeData;
    if (requireAttached && unit.addOnTag && parseInt(unit.addOnTag) === 0) {
      if (typeof techRequirement !== 'undefined') {
        const matchingAddOnTypes = techLabTypes.includes(techRequirement) ? techLabTypes : reactorTypes.includes(techRequirement) ? reactorTypes : [techRequirement];
        const requiredAddOns = units.getById(matchingAddOnTypes).filter(addOn => {
          if (!addOn.pos) return false; // Check if addOn's position is undefined

          const addOnBuildingPosition = BuildingPlacement.getAddOnBuildingPosition(addOn.pos);
          if (!addOnBuildingPosition) return false; // Check for undefined

          const addOnBuildings = units.getStructures().filter(structure => structure.addOnTag === addOn.tag && structure.buildProgress === 1);
          const closestAddOnBuilding = units.getClosest(addOnBuildingPosition, addOnBuildings)[0];
          return closestAddOnBuilding && closestAddOnBuilding.noQueue && getPendingOrders(closestAddOnBuilding).length === 0;
        });
        const addOn = selectRandomUnit(requiredAddOns);
        if (addOn && addOn.pos) { // Additional check for addOn.pos
          const addOnBuildingPosition = BuildingPlacement.getAddOnBuildingPosition(addOn.pos);
          if (addOnBuildingPosition) {
            unit.labels.set('reposition', addOnBuildingPosition);
            const addOnBuildings = units.getStructures().filter(structure => structure.addOnTag === addOn.tag);
            const closestAddOnBuilding = units.getClosest(addOnBuildingPosition, addOnBuildings)[0];
            if (closestAddOnBuilding) {
              closestAddOnBuilding.labels.set('reposition', 'lift');
            }
          }
        }
      }
    }

    const unitCommand = createUnitCommand(abilityId, [unit]);
    setPendingOrders(unit, unitCommand);
  };


  // Move the logic for determining if a unit can be trained here
  const canTrainUnit = (/** @type {World} */ world, /** @type {number} */ unitTypeId) => {
    return targetCount === null || checkUnitCount(world, unitTypeId, targetCount);
  };

  if (canTrainUnit(world, unitTypeId)) {
    earmarkNeeded = earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);
    const trainers = getTrainer(world, unitTypeId);
    const safeTrainers = trainers.filter(trainer => {
      if (trainer.pos) {
        return isStrongerAtPosition(world, trainer.pos);
      }
      return false;
    });
    const randomSafeTrainer = selectRandomUnit(safeTrainers);

    if (randomSafeTrainer && canBuild(world, unitTypeId)) {
      if (randomSafeTrainer.unitType !== UnitType.WARPGATE) {
        const trainerActions = handleNonWarpgateTrainer(randomSafeTrainer); // Assuming this now returns actions
        collectedActions.push(...trainerActions);
      } else {
        // Handle WARPGATE case, potentially collecting actions
      }
    }

    if (!canBuild(world, unitTypeId)) {
      const { requireAttached, techRequirement } = unitTypeData;
      if (requireAttached || techRequirement) {
        let canDoTypes = data.findUnitTypesWithAbility(abilityId);
        const canDoUnits = units.getById(canDoTypes).filter(unit => unit.abilityAvailable(abilityId));
        let unit = selectRandomUnit(canDoUnits);

        if (!unit && agent.canAfford(unitTypeId)) {
          if (typeof techRequirement === 'number') {
            handleTechRequirements(unit, techRequirement);
          } else {
            // Handle the case where techRequirement is undefined.
            return collectedActions;
          }
        } else if (!unit) {
          const idleUnits = units.getById(canDoTypes).filter(unit => unit.isIdle() && unit.buildProgress === 1);
          const unitToReserve = selectRandomUnit(idleUnits);
          if (unitToReserve) {
            const unitCommand = createUnitCommand(abilityId, [unitToReserve]);
            setPendingOrders(unitToReserve, unitCommand);
          }
        } else {
          handleUnitBuilding(unit);
        }
      }
      earmarkNeeded = earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);
    }
  }
  earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);

  return collectedActions;
}

/**
 * @param {World} world 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function trainCombatUnits(world) {
  const { OVERLORD } = UnitType;
  const { agent, data, resources } = world;
  const { minerals, vespene } = agent;
  if (minerals === undefined || vespene === undefined) return [];
  const { units } = resources.get();
  const collectedActions = [];

  const strategyManager = StrategyManager.getInstance();
  const currentStrategy = strategyManager.getCurrentStrategy();

  // Check if currentStrategy is defined
  if (!currentStrategy) {
    console.error('Current strategy is undefined.');
    return [];
  }

  const plannedTrainingTypes = strategyManager.getTrainingTypes().length > 0
    ? strategyManager.getTrainingTypes()
    : getExistingTrainingTypes(units);

  const currentStep = strategyManager.getCurrentStep();
  const currentPlanStep = currentStrategy.steps[currentStep];

  const gameState = GameState.getInstance();

  const candidateTypesToBuild = plannedTrainingTypes.filter(type => {
    const { attributes, foodRequired } = data.getUnitTypeData(type);
    if (attributes === undefined || foodRequired === undefined) return false;
    const supply = currentPlanStep ? parseInt(currentPlanStep.supply, 10) : 0;

    // Convert type to string for indexing UnitTypeId
    const unitTypeIdKey = String(type);
    const planMinForType = strategyManager.getPlanMin()[unitTypeIdKey];

    return (!attributes.includes(Attribute.STRUCTURE) && type !== OVERLORD) &&
      foodRequired <= supply - gameState.getFoodUsed() &&
      (strategyManager.getOutpowered()
        ? strategyManager.getOutpowered()
        : (planMinForType !== undefined ? planMinForType <= gameState.getFoodUsed() : true)) &&
      (!strategyManager.getUnitMax()[unitTypeIdKey]
        || (getUnitTypeCount(world, type) < strategyManager.getUnitMax()[unitTypeIdKey])) &&
      gameState.checkTechFor(agent, type) &&
      checkProductionAvailability(world, type);
  });

  if (candidateTypesToBuild.length > 0) {
    let selectedType = strategyManager.getSelectedTypeToBuild() !== null
      ? strategyManager.getSelectedTypeToBuild()
      : strategyManager.selectTypeToBuild(world, candidateTypesToBuild);

    if (selectedType !== undefined && selectedType !== null) {
      if (strategyManager.getOutpowered() || agent.canAfford(selectedType)) {
        collectedActions.push(...train(world, selectedType));
      }
    }
    strategyManager.setSelectedTypeToBuild(selectedType);
  }

  return collectedActions;
}


/**
 * Implement direct worker training logic here.
 * @param {World} world
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function trainWorkersDirectly(world) {
  const { agent, data, resources } = world;
  const { minerals, race } = agent;
  if (minerals === undefined || race === undefined) return [];

  const workerTypeId = WorkerRace[race];
  const workerTypeData = data.getUnitTypeData(workerTypeId);
  const { abilityId } = workerTypeData;
  if (!abilityId) return [];

  const bases = resources.get().units.getBases();
  const collectedActions = [];

  for (const base of bases) {
    if (base.isIdle() && (base.buildProgress ?? 0) >= 1) {
      const unitCommand = createUnitCommand(abilityId, [base]);
      collectedActions.push(unitCommand);
    }
  }

  return collectedActions;
}

/**
 * Refactored to return a list of actions instead of sending them directly.
 * @param {World} world 
 * @param {number} upgradeId 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
 */
function upgrade(world, upgradeId) {
  const { BARRACKS, TECHLAB } = UnitType;
  const { techLabTypes } = groupTypes;
  const { agent, data, resources } = world;
  const { upgradeIds } = agent; 
  if (upgradeIds === undefined) return [];
  
  const { units } = resources.get();
  if (upgradeIds.includes(upgradeId)) return [];
  
  const upgraders = units.getUpgradeFacilities(upgradeId).filter(upgrader => upgrader.alliance === Alliance.SELF);
  const upgradeData = data.getUpgradeData(upgradeId);
  const { abilityId } = upgradeData; 
  if (abilityId === undefined) return [];
  
  const upgradeInProgress = upgraders.find(upgrader => upgrader.orders && upgrader.orders.find(order => order.abilityId === abilityId));
  if (upgradeInProgress) return [];
  
  let actionsToPerform = [];
  const gameState = GameState.getInstance();
  if (agent.canAffordUpgrade(upgradeId)) {
    const upgrader = getRandom(upgraders.filter(upgrader => {
      return upgrader.noQueue && upgrader.abilityAvailable(abilityId);
    }));
    if (upgrader) {
      const unitCommand = createUnitCommand(abilityId, [upgrader]);
      actionsToPerform.push(unitCommand);
      setPendingOrders(upgrader, unitCommand);
    } else {
      const techLabRequired = techLabTypes.some(techLabType => UnitAbilityMap[techLabType].some(ability => ability === abilityId));
      if (techLabRequired) {
        const techLabs = units.getAlive(Alliance.SELF).filter(unit => {
          // Ensure unitType is defined before using it
          return unit.unitType !== undefined && techLabTypes.includes(unit.unitType);
        });
        const orphanTechLabs = techLabs.filter(techLab => {
          const { pos } = techLab; if (pos === undefined) return false;
          const footprint = getFootprint(BARRACKS); if (footprint === undefined) return false;
          return techLab.unitType === TECHLAB && !pointsOverlap(cellsInFootprint(getAddOnBuildingPlacement(pos), footprint), landingGrids);
        });
        if (orphanTechLabs.length > 0) {
          // Retrieve barracks unit IDs from GameState
          const barracksTypeIds = gameState.countTypes.get(BARRACKS);

          // Filter only completed barracks
          /** @type {Unit[]} */
          let completedBarracks = [];
          if (barracksTypeIds !== undefined) {
            completedBarracks = units.getById(barracksTypeIds).filter(barracks => barracks.buildProgress !== undefined && barracks.buildProgress >= 1);
          }

          let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);

          // If no idle barracks, get closest barracks to tech lab that are either not training a unit or have orders with progress less than 0.5

          const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => {
            const firstOrder = barracks.orders && barracks.orders[0];
            return isTrainingUnit(data, barracks) && (firstOrder ? (firstOrder.progress !== undefined && firstOrder.progress <= 0.5) : true);
          });

          if (barracks.length > 0) {
            /** @type {{barracks: Unit | undefined, addOnPosition: Point2D | undefined}} */
            let closestPair = { barracks: undefined, addOnPosition: undefined };

            barracks.forEach(barracksUnit => {
              orphanTechLabs.forEach(techLab => {
                if (!techLab.pos) return false;

                const addOnBuildingPosition = BuildingPlacement.getAddOnBuildingPosition(techLab.pos);

                if (!closestPair.barracks || !closestPair.addOnPosition) {
                  closestPair = { barracks: barracksUnit, addOnPosition: addOnBuildingPosition };
                } else {
                  if (getDistance(barracksUnit.pos, addOnBuildingPosition) < getDistance(closestPair.barracks.pos, closestPair.addOnPosition)) {
                    closestPair = { barracks: barracksUnit, addOnPosition: addOnBuildingPosition };
                  }
                }
              });
            });
            if (closestPair.barracks && closestPair.addOnPosition) {
              // if barracks is training unit, cancel training.
              if (isTrainingUnit(data, closestPair.barracks)) {
                if (closestPair.barracks && closestPair.barracks.orders) {
                  for (let i = 0; i < closestPair.barracks.orders.length; i++) {
                    const cancelCommand = createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair.barracks]);
                    actionsToPerform.push(cancelCommand);
                    setPendingOrders(closestPair.barracks, cancelCommand);
                  }
                }
              }
              // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
              const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
              const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
              const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);

              // Here, handle the undefined movementSpeed
              const unitTypeData = data.getUnitTypeData(UnitType.BARRACKSFLYING);
              if (unitTypeData === undefined || unitTypeData.movementSpeed === undefined) {
                // If movementSpeed is undefined, return empty array or handle it appropriately
                return [];
              }

              const movementSpeedPerSecond = unitTypeData.movementSpeed * 1.4;
              const distance = getDistance(closestPair.barracks.pos, closestPair.addOnPosition);
              const timeToMove = distance / movementSpeedPerSecond + (liftAndLandingTime * 2);

              if (timeUntilUpgradeCanStart < timeToMove) {
                const label = 'reposition';
                closestPair.barracks.labels.set(label, closestPair.addOnPosition);
              }
            }
          }
        } else {

          const nonOrphanTechLabs = techLabs.filter(techLab => techLab.unitType !== TECHLAB);
          // find idle building with tech lab.
          const idleBuildingsWithTechLab = nonOrphanTechLabs
            .map(techLab => {
              // Check if techLab.pos is defined before proceeding
              if (!techLab.pos) return undefined;

              const addOnBuildingPosition = BuildingPlacement.getAddOnBuildingPosition(techLab.pos);
              // Ensure addOnBuildingPosition is defined before calling getClosest
              if (!addOnBuildingPosition) return undefined;

              return units.getClosest(addOnBuildingPosition, units.getAlive(Alliance.SELF), 1)[0];
            })
            .filter(building => building && building.noQueue && getPendingOrders(building).length === 0);

          // find closest barracks to closest tech lab.
          /** @type {Unit[]} */
          let closestPair = [];
          // Get the barracks type IDs from GameState, ensuring it's not undefined
          const barracksTypeIds = gameState.countTypes.get(BARRACKS);
          if (barracksTypeIds === undefined) {
            // Handle the undefined case, e.g., return an empty array or proceed with a default value
            return [];
          }

          // Now that we've ensured barracksTypeIds is defined, we can safely use it in units.getById
          let completedBarracks = units.getById(barracksTypeIds).filter(barracks =>
            barracks.buildProgress !== undefined && barracks.buildProgress >= 1
          );

          // Filter only those barracks that have no queue
          let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);
          // if no idle barracks, get closest barracks to tech lab.
          const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => {
            // Safely check the progress of the first order
            const firstOrderProgress = barracks.orders?.[0]?.progress ?? 1; // Default to 1 if undefined
            return isTrainingUnit(data, barracks) && firstOrderProgress <= 0.5;
          });
          if (barracks.length > 0 && idleBuildingsWithTechLab.length > 0) {
            barracks.forEach(barracksUnit => {
              idleBuildingsWithTechLab.forEach(idleBuildingWithTechLab => {
                if (!idleBuildingWithTechLab) return; // Skip if idleBuildingWithTechLab is undefined

                // Only proceed if both barracksUnit and idleBuildingWithTechLab have defined positions
                if (barracksUnit.pos && idleBuildingWithTechLab.pos) {
                  if (closestPair.length > 0) {
                    closestPair = getDistance(barracksUnit.pos, idleBuildingWithTechLab.pos) < getDistance(closestPair[0].pos, closestPair[1].pos) ?
                      [barracksUnit, idleBuildingWithTechLab] : closestPair;
                  } else {
                    closestPair = [barracksUnit, idleBuildingWithTechLab];
                  }
                }
              });
            });
          }
          if (closestPair.length > 0) {
            const { pos: pos0, orders: orders0 } = closestPair[0];
            if (pos0 === undefined || orders0 === undefined) return []; // Return an empty array
            const { pos: pos1 } = closestPair[1]; if (pos1 === undefined) return [];
            // if barracks is training unit, cancel training.
            // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
            const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
            const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
            const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);
            const distance = getDistance(pos1, pos0);
            if (distance > 0) {
              const { movementSpeed } = data.getUnitTypeData(UnitType.BARRACKSFLYING); if (movementSpeed === undefined) return [];
              const movementSpeedPerSecond = movementSpeed * 1.4;
              const timeToMove = distance / movementSpeedPerSecond + (64 / 22.4);
              if (timeUntilUpgradeCanStart < timeToMove) {
                // Check if the unit is training and has orders before iterating over them
                if (isTrainingUnit(data, closestPair[0]) && closestPair[0].orders) {
                  for (let i = 0; i < closestPair[0].orders.length; i++) {
                    const cancelCommand = createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair[0]]);
                    actionsToPerform.push(cancelCommand);
                    setPendingOrders(closestPair[0], cancelCommand);
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
      const techLabs = units.getAlive(Alliance.SELF).filter(unit => {
        // Check if unitType is defined before using it in the filter
        return unit.unitType !== undefined && techLabTypes.includes(unit.unitType);
      });
      const orphanTechLabs = techLabs.filter(techLab => {
        const { pos } = techLab; if (pos === undefined) return false;
        const footprint = getFootprint(BARRACKS); if (footprint === undefined) return false;
        return techLab.unitType === TECHLAB && !pointsOverlap(cellsInFootprint(getAddOnBuildingPlacement(pos), footprint), landingGrids);
      });
      if (orphanTechLabs.length > 0) {
        // get completed and idle barracks
        /** @type {Unit[]} */
        let completedBarracks = [];
        const barracksTypeIds = gameState.countTypes.get(UnitType.BARRACKS);
        if (barracksTypeIds) {
          completedBarracks = units.getById(barracksTypeIds).filter(barracks =>
            barracks.buildProgress !== undefined && barracks.buildProgress >= 1);
        }
        let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);

        // Filter barracks based on their training status and the progress of their first order
        const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => {
          // Safely check the progress of the first order, default to 1 if undefined
          const firstOrderProgress = barracks.orders?.[0]?.progress ?? 1;
          return isTrainingUnit(data, barracks) && firstOrderProgress <= 0.5;
        });

        if (barracks.length > 0) {
          // Initialize closestPair as an empty array of Unit
          /** @type {Unit[]} */
          let closestPair = [];

          // Initialize a variable to track the minimum distance
          let minDistance = Infinity;

          // Iterate over barracks and tech labs to find the closest pair
          barracks.forEach(barracksUnit => {
            orphanTechLabs.forEach(techLab => {
              // Ensure both positions are defined
              if (!barracksUnit.pos || !techLab.pos) return;

              const addOnBuildingPosition = BuildingPlacement.getAddOnBuildingPosition(techLab.pos);
              const distance = getDistance(barracksUnit.pos, addOnBuildingPosition);
              if (distance < minDistance) {
                minDistance = distance;
                closestPair = [barracksUnit, techLab]; // Only include Unit objects
              }
            });
          });

          if (closestPair.length > 0) {
            // Destructure the closest pair to extract the units
            const [barracksUnit, techLabUnit] = closestPair;

            // Ensure both units have defined positions
            if (!barracksUnit.pos || !techLabUnit.pos) return [];

            // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
            const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
            const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
            const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);

            const distance = getDistance(barracksUnit.pos, techLabUnit.pos);
            const movementSpeedData = data.getUnitTypeData(UnitType.BARRACKSFLYING);

            // Ensure movementSpeedData and its movementSpeed property are defined
            if (!movementSpeedData || movementSpeedData.movementSpeed === undefined) return [];

            const movementSpeedPerSecond = movementSpeedData.movementSpeed * 1.4;
            const timeToMove = distance / movementSpeedPerSecond + (liftAndLandingTime * 2);

            if (timeUntilUpgradeCanStart < timeToMove) {
              // Label the barracks for repositioning
              barracksUnit.labels.set('reposition', techLabUnit.pos);
              techLabUnit.labels.set('lift', true); // Indicate that the tech lab needs to lift
            }
          }
        }
      } else {
        const nonOrphanTechLabs = techLabs.filter(techLab => techLab.unitType !== TECHLAB);
        // find idle building with tech lab.
        const idleBuildingsWithTechLab = nonOrphanTechLabs
          .map(techLab => {
            // Check if techLab.pos is defined before proceeding
            if (!techLab.pos) {
              // Handle the undefined case (e.g., skip this iteration)
              return undefined;
            }

            // Now that techLab.pos is confirmed to be defined, use it in the function call
            const addOnBuildingPosition = BuildingPlacement.getAddOnBuildingPosition(techLab.pos);
            if (!addOnBuildingPosition) return undefined;
            // Proceed with the rest of your logic...
            return units.getClosest(addOnBuildingPosition, units.getAlive(Alliance.SELF), 1)[0];
          })
          .filter(building => building && building.noQueue && getPendingOrders(building).length === 0);
        // find closest barracks to closest tech lab.
        /** @type {Unit[]} */
        let closestPair = [];
        // get completed and idle barracks.
        /** @type {Unit[]} */
        let completedBarracks = [];
        const barracksTypeIds = gameState.countTypes.get(UnitType.BARRACKS);

        if (barracksTypeIds) {
          completedBarracks = units.getById(barracksTypeIds).filter(barracks =>
            barracks.buildProgress !== undefined && barracks.buildProgress >= 1
          );
        }
        let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);
        // if no idle barracks, get closest barracks to tech lab.
        const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => {
          // Check if 'orders' is defined before accessing its elements
          if (!barracks.orders || barracks.orders.length === 0) {
            return false; // Skip this barracks if it has no orders
          }

          // Safely access the first order's progress
          const firstOrderProgress = barracks.orders[0].progress;
          return isTrainingUnit(data, barracks) && (firstOrderProgress !== undefined && firstOrderProgress <= 0.5);
        });
        if (barracks.length > 0 && idleBuildingsWithTechLab.length > 0) {
          barracks.forEach(barracksUnit => {
            idleBuildingsWithTechLab.forEach(idleBuildingWithTechLab => {
              // Only proceed if both barracksUnit and idleBuildingWithTechLab are defined
              if (!barracksUnit || !idleBuildingWithTechLab) return;

              // Existing distance calculation logic...
              if (closestPair.length > 0) {
                closestPair = getDistance(barracksUnit.pos, idleBuildingWithTechLab.pos) < getDistance(closestPair[0].pos, closestPair[1].pos) ?
                  [barracksUnit, idleBuildingWithTechLab] : closestPair;
              } else {
                closestPair = [barracksUnit, idleBuildingWithTechLab];
              }
            });
          });
        }
        if (closestPair.length > 0) {
          const { pos: pos0, orders: orders0 } = closestPair[0];
          if (pos0 === undefined || orders0 === undefined) return [];
          const { pos: pos1 } = closestPair[1]; if (pos1 === undefined) return [];

          const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
          const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
          const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);
          const distance = getDistance(pos1, pos0);
          if (distance > 0) {
            const { movementSpeed } = data.getUnitTypeData(UnitType.BARRACKSFLYING); if (movementSpeed === undefined) return [];
            const movementSpeedPerSecond = movementSpeed * 1.4;
            const timeToMove = distance / movementSpeedPerSecond + (64 / 22.4);
            if (timeUntilUpgradeCanStart < timeToMove) {
              if (isTrainingUnit(data, closestPair[0]) && closestPair[0].orders) {
                for (let i = 0; i < closestPair[0].orders.length; i++) {
                  const cancelCommand = createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair[0]]);
                  actionsToPerform.push(cancelCommand);
                  setPendingOrders(closestPair[0], cancelCommand);
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

  return actionsToPerform;
}

module.exports = {
  unitProductionAvailable,
  buildSupplyOrTrain,
  getFoodDifference,
  getProductionUnits,
  haveAvailableProductionUnitsFor,
  manageZergSupply,
  refreshProductionUnitsCache,
  train,
  upgrade,
};
