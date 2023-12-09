//@ts-check
"use strict";

// External library imports
const { UnitType, UnitTypeId, Ability, WarpUnitAbility } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");

// Internal module imports: Game State and Building Utilities
const BuildingPlacement = require("./buildingPlacement");
const { hasAddOn } = require("./buildingSharedUtils");
const { setPendingOrders } = require("./common");
const { missingUnits } = require("./gameDataStore");
const GameState = require("./gameState");
const { getDistance } = require("./geometryUtils");
const { addEarmark, getById } = require("./resourceUtils");
const { mappedEnemyUnits } = require("./scoutingUtils");
const { earmarkResourcesIfNeeded } = require("./sharedEconomicFunctions");
const { getPendingOrders } = require("./sharedUtils");
// Internal module imports: Unit Configuration and Actions
const { attemptBuildAddOn, attemptLiftOff } = require("./unitActions");
const { canUnitBuildAddOn, flyingTypesMapping, unitTypeTrainingAbilities } = require("./unitConfig");
const { calculateLiftLandAndMoveTime, updateAddOnType, getUnitTypeToBuild, getUnitTypeCount, potentialCombatants, calculateTimeToKillUnits } = require("./unitHelpers");
const { getTimeInSeconds, createUnitCommand, findKeysForValue, canBuild } = require("./utils");

/** @type {Map<UnitTypeId, Unit[]>} */
const productionUnitsCache = new Map();

/**
 * Adds addon, with placement checks and relocating logic.
 * @param {World} world 
 * @param {Unit} unit 
 * @param {UnitTypeId} addOnType 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function addAddOn(world, unit, addOnType) {
  const { landingAbilities, liftingAbilities } = groupTypes;
  const { data } = world;
  const { tag } = unit;
  const collectedActions = [];

  if (tag === undefined) return collectedActions;

  const gameState = GameState.getInstance();
  addOnType = updateAddOnType(addOnType, gameState.countTypes);
  const unitTypeToBuild = getUnitTypeToBuild(unit, flyingTypesMapping, addOnType);

  // Check if unitTypeToBuild is defined and retrieve abilityId
  if (unitTypeToBuild === undefined) return collectedActions;
  const unitTypeData = data.getUnitTypeData(unitTypeToBuild);
  if (!unitTypeData || unitTypeData.abilityId === undefined) return collectedActions;
  const abilityId = unitTypeData.abilityId;

  const unitCommand = { abilityId, unitTags: [tag] };

  if (!unit.noQueue || unit.labels.has('swapBuilding') || getPendingOrders(unit).length > 0) {
    return collectedActions;
  }

  const availableAbilities = unit.availableAbilities();

  if (unit.abilityAvailable(abilityId)) {
    const buildAddOnActions = attemptBuildAddOn(world, unit, addOnType, unitCommand);
    if (buildAddOnActions && buildAddOnActions.length > 0) {
      addEarmark(data, unitTypeData);
      collectedActions.push(...buildAddOnActions);
      return collectedActions;
    }
  }

  if (availableAbilities.some(ability => liftingAbilities.includes(ability))) {
    const liftOffActions = attemptLiftOff(unit);
    if (liftOffActions && liftOffActions.length > 0) {
      collectedActions.push(...liftOffActions);
      return collectedActions;
    }
  }

  if (availableAbilities.some(ability => landingAbilities.includes(ability))) {
    const landActions = attemptLand(world, unit, addOnType);
    collectedActions.push(...landActions);
  }

  return collectedActions;
}

/**
 * Attempts to land the unit at a suitable location.
 * @param {World} world
 * @param {Unit} unit 
 * @param {UnitTypeId} addOnType 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function attemptLand(world, unit, addOnType) {
  const { data } = world;
  const { tag, unitType } = unit; if (tag === undefined || unitType === undefined) return [];
  const collectedActions = [];

  const foundPosition = BuildingPlacement.checkAddOnPlacement(world, unit, addOnType);

  if (foundPosition) {
    unit.labels.set('addAddOn', foundPosition);

    const unitCommand = {
      abilityId: data.getUnitTypeData(UnitType[`${UnitTypeId[flyingTypesMapping.get(unitType) || unitType]}${UnitTypeId[addOnType]}`]).abilityId,
      unitTags: [tag],
      targetWorldSpacePos: foundPosition
    }

    collectedActions.push(unitCommand);
    setPendingOrders(unit, unitCommand);
    addEarmark(data, data.getUnitTypeData(addOnType));
  }

  return collectedActions;
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
 * @param {Unit} unit
 * @returns {number}
 */
function getTimeUntilUnitCanBuildAddon(world, unit) {
  const { data } = world;
  const { buildProgress, isFlying, orders, pos, unitType } = unit;
  if (buildProgress === undefined || isFlying === undefined || orders === undefined || pos === undefined || unitType === undefined) return Infinity;

  // If unit is under construction, calculate the time until it finishes
  if (buildProgress !== undefined && buildProgress < 1) {
    const { buildTime } = data.getUnitTypeData(unitType); if (buildTime === undefined) return Infinity;
    const remainingTime = getTimeInSeconds(buildTime - (buildTime * buildProgress));
    return remainingTime;
  }

  // If unit is idle, check if it already has an add-on
  if (unit.isIdle()) {
    // If unit already has an add-on, calculate the time it takes for the structure to lift off, move, and land
    if (hasAddOn(unit)) {
      return calculateLiftLandAndMoveTime(world, unit);
    } else if (isFlying) { // New condition for flying and idle units
      return calculateLiftLandAndMoveTime(world, unit);
    }
    return 0;
  }

  // If unit is flying or its unit type indicates that it's a flying unit
  if (isFlying || flyingTypesMapping.has(unitType)) {
    if (orders && orders.length > 0) {
      const order = orders[0];
      if (order.targetWorldSpacePos) {
        return calculateLiftLandAndMoveTime(world, unit, order.targetWorldSpacePos);
      }
    }

    // If the unit's orders don't provide a target position, return Infinity
    return Infinity;
  }

  // If unit is training or doing something else, calculate the time until it finishes
  if (orders && orders.length > 0) {
    const order = orders[0];
    const { abilityId, progress } = order; if (abilityId === undefined || progress === undefined) return Infinity;
    const unitTypeTraining = unitTypeTrainingAbilities.get(abilityId); if (unitTypeTraining === undefined) return Infinity;
    const { buildTime } = data.getUnitTypeData(unitTypeTraining); if (buildTime === undefined) return Infinity;

    const remainingTime = getTimeInSeconds(buildTime - (buildTime * progress));
    if (hasAddOn(unit)) {
      return remainingTime + calculateLiftLandAndMoveTime(world, unit);
    }
    return remainingTime;
  }

  // If unit is not idle, not under construction, and not building something, assume it will take a longer time to be available
  return Infinity;
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
 * Get units that are capable to add an add-on (either they don't have one or they have one but can add another).
 * @param {Unit[]} units 
 * @returns {Unit[]}
 */
function getUnitsCapableToAddOn(units) {
  return units.filter(unit => unit.unitType && canUnitBuildAddOn(unit.unitType));
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

module.exports = {
  addAddOn,
  getProductionUnits,
  getTimeUntilUnitCanBuildAddon,
  getUnitsCapableToAddOn,
  refreshProductionUnitsCache,
  train
};
