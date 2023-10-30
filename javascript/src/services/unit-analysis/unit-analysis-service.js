//@ts-check
"use strict"

const { Alliance } = require('@node-sc2/core/constants/enums');
const { getById } = require('../unit-retrieval');
const { getDistance } = require('../../../services/position-service');
const unitService = require('../../../services/unit-service');
const { morphMapping, flyingTypesMapping } = require('../../../helper/groups');
const { UnitType } = require('@node-sc2/core/constants');
const trackUnitsService = require('../../../systems/track-units/track-units-service');
const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');
const { getAddOnPlacement, getAddOnBuildingPlacement } = require('../../../helper/placement/placement-utilities');
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { getFootprint } = require('@node-sc2/core/utils/geometry/units');
const { existsInMap } = require('../../../helper/location');
const { pointsOverlap } = require('../../../helper/utilities');
const unitResourceService = require('../../../systems/unit-resource/unit-resource-service');
const { PlacementService } = require('../placement');
const { canUnitBuildAddOn } = require('../utility-service');
const { getStringNameOfConstant } = require('../shared-utilities/common-utilities');


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

  if (morphMapping.has(unitType)) {
    const mappingValue = morphMapping.get(unitType);
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
    const unitPendingOrders = unitService.getPendingOrders(u);
    return unitPendingOrders && unitPendingOrders.some(o => o.abilityId === abilityId);
  });

  let adjustedTargetCount = targetCount;
  if (unitType === UnitType.ZERGLING) {
    const existingZerglings = getById(resources, [UnitType.ZERGLING]).length;
    const oddZergling = existingZerglings % 2;
    adjustedTargetCount += oddZergling;
  }

  const unitCount = getById(resources, unitTypes).length + orders.length + unitsWithPendingOrders.length + trackUnitsService.missingUnits.filter(unit => unit.unitType === unitType).length;

  return unitCount === adjustedTargetCount;
}

/**
 * @param {World} world 
 * @param {Unit} building 
 * @param {UnitTypeId} addOnType 
 * @returns {Point2D | undefined}
 */
function checkAddOnPlacement(world, building, addOnType = UnitType.REACTOR) {
  const { REACTOR, TECHLAB } = UnitType;
  const { resources } = world;
  const { map, units } = resources.get();
  const { unitType } = building; if (unitType === undefined) return;
  if (canUnitBuildAddOn(unitType)) {
    let position = null;
    let addOnPosition = null;
    let range = 1;
    do {
      const nearPoints = gridsInCircle(getAddOnPlacement(building.pos), range).filter(grid => {
        const addOnBuildingPlacementsForOrphanAddOns = units.getStructures(Alliance.SELF).reduce((/** @type {Point2D[]} */acc, structure) => {
          const { unitType } = structure; if (unitType === undefined) return acc;
          const isOrphanAddOn = [REACTOR, TECHLAB].includes(unitType); if (!isOrphanAddOn) return acc;
          return [...acc, ...cellsInFootprint(getAddOnBuildingPlacement(structure.pos), { h: 3, w: 3 })];
        }, []);
        const getBuildingAndAddOnPlacement = [...cellsInFootprint(grid, getFootprint(addOnType)), ...cellsInFootprint(getAddOnBuildingPlacement(grid), { h: 3, w: 3 })];
        return [
          existsInMap(map, grid) && map.isPlaceableAt(addOnType, grid) && map.isPlaceableAt(flyingTypesMapping.get(building.unitType) || building.unitType, getAddOnBuildingPlacement(grid)),
          !pointsOverlap(getBuildingAndAddOnPlacement, [...unitResourceService.seigeTanksSiegedGrids, ...addOnBuildingPlacementsForOrphanAddOns]),
        ].every(condition => condition);
      });
      if (nearPoints.length > 0) {
        if (Math.random() < (1 / 2)) {
          addOnPosition = nearPoints[Math.floor(Math.random() * nearPoints.length)];
          console.log(`isPlaceableAt for ${getStringNameOfConstant(UnitType, addOnType)}`, addOnPosition);
          position = getAddOnBuildingPlacement(addOnPosition);
          console.log(`isPlaceableAt for ${getStringNameOfConstant(UnitType, building.unitType)}`, position);
        } else {
          addOnPosition = PlacementService.findPosition(world, addOnType, nearPoints);
          if (addOnPosition) {
            position = PlacementService.findPosition(world, building.unitType, [getAddOnBuildingPlacement(addOnPosition)]);
          }
        }
      }
      range++
    } while (!position || !addOnPosition);
    return position;
  } else {
    return;
  }
}

/**
 * Gets potential combatant units within a certain radius.
 * 
 * @param {World} world - The current state of the world.
 * @param {Unit} unit - The reference unit to check radius around.
 * @param {number} radius - The radius to check for units.
 * @returns {Unit[]} - Array of potential combatant units.
 */
function getPotentialCombatantsInRadius(world, unit, radius) {
  // Destructure to get the units directly
  const units = world.resources.get().units;

  // Use a single filtering operation to get potential combatants in the given radius.
  return units.getAlive(Alliance.SELF).filter(targetUnit => {
    // Check if both units have valid positions
    if (!unit.pos || !targetUnit.pos) return false;

    // Check if the target unit is within the radius
    const isWithinRadius = getDistance(unit.pos, targetUnit.pos) <= radius;
    // Check if the target unit is a potential combatant
    const isPotentialCombatant = unitService.potentialCombatants(targetUnit);
    return isWithinRadius && isPotentialCombatant;
  });
}

module.exports = {
  checkUnitCount,
  checkAddOnPlacement,
  getPotentialCombatantsInRadius,
};