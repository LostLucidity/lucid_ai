const { Ability, UnitType } = require("@node-sc2/core/constants");
const groupTypes = require("@node-sc2/core/constants/groups");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const { buildUnitTypeMap } = require("../features/misc/gameData");
const { getDistance } = require("../gameLogic/shared/spatialCoreUtils");
const { isPendingContructing } = require("../gameLogic/shared/workerCommonUtils");
const { GameState, buildingPositions } = require("../gameState");
const { getPendingOrders } = require("../sharedServices");

/**
 * @param {World} world
 * @returns {Object.<number, string>}
 */
function buildAbilityIdToUnitTypeMap(world) {
  const UnitTypeMap = buildUnitTypeMap(world.data);
  /** @type {Object.<number, string>} */
  const abilityIdToUnitTypeMap = {};

  for (const [unitTypeName, abilityId] of Object.entries(UnitTypeMap)) {
    abilityIdToUnitTypeMap[Number(abilityId)] = unitTypeName;
  }

  return abilityIdToUnitTypeMap;
}

/**
 * @param {World} world
 * @returns {Point2D[]}
 */
function getCurrentlyEnrouteConstructionGrids(world) {
  const { constructionAbilities } = groupTypes;
  const { resources } = world;
  const { units } = resources.get();
  /** @type {Point2D[]} */
  const constructionGrids = [];
  const abilityIdToUnitTypeMap = buildAbilityIdToUnitTypeMap(world);
  const gameState = GameState.getInstance();
  const workers = units.getWorkers();

  workers.forEach(worker => {
    const allOrders = worker.orders ? [...worker.orders, ...getPendingOrders(worker)] : getPendingOrders(worker);
    const moveOrder = allOrders.find(order => order.abilityId === Ability.MOVE && order.targetWorldSpacePos);

    if (moveOrder && moveOrder.targetWorldSpacePos) {
      const intendedConstructionLocation = moveOrder.targetWorldSpacePos;
      const buildingStep = getClosestBuildingStep(intendedConstructionLocation);

      if (buildingStep) {
        const stepNumber = buildingStep[0];
        const buildingType = gameState.getBuildingTypeByStepNumber(stepNumber);
        if (buildingType) {
          const footprint = getFootprint(buildingType);
          if (footprint && footprint.w && footprint.h) {
            constructionGrids.push(...cellsInFootprint(createPoint2D(intendedConstructionLocation), footprint));
          }
        }
      }
    }

    if (worker.isConstructing() || isPendingContructing(worker)) {
      const foundOrder = allOrders.find(order => order.abilityId && constructionAbilities.includes(order.abilityId));
      if (foundOrder && foundOrder.targetWorldSpacePos && foundOrder.abilityId !== undefined) {
        const unitTypeName = abilityIdToUnitTypeMap[foundOrder.abilityId];
        if (unitTypeName) {
          const unitType = UnitType[unitTypeName.toUpperCase()];
          const footprint = getFootprint(unitType);
          if (footprint && footprint.w && footprint.h) {
            constructionGrids.push(...cellsInFootprint(createPoint2D(foundOrder.targetWorldSpacePos), footprint));
          }
        }
      }
    }
  });

  return constructionGrids;

  /**
   * Find the closest building step to the intended construction location.
   * @param {Point2D} location
   * @returns {[number, Point2D] | null}
   */
  function getClosestBuildingStep(location) {
    /** @type {[number, Point2D] | null} */
    let closestEntry = null;
    let closestDistance = Infinity;

    for (const [stepNumber, pos] of buildingPositions.entries()) {
      if (!pos) continue;

      const currentDistance = getDistance(pos, location);
      if (currentDistance < closestDistance) {
        closestEntry = [stepNumber, pos];
        closestDistance = currentDistance;
      }
    }

    return closestEntry;
  }
}

module.exports = {
  getCurrentlyEnrouteConstructionGrids,
};
