const { Ability } = require("@node-sc2/core/constants");
const groupTypes = require("@node-sc2/core/constants/groups");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const { GameState, buildingPositions } = require("../../core/gameState");
const { isPendingContructing } = require("../../gameLogic/unit/workerCommonUtils");
const { getPendingOrders } = require("../../sharedServices");
const { buildUnitTypeMap } = require("../../utils/misc/gameData");
const { getDistance } = require("../../utils/spatial/spatialCoreUtils");


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

  const UnitTypeMap = buildUnitTypeMap(world.data);

  const gameState = GameState.getInstance();

  units.getWorkers().forEach(worker => {
    const { orders } = worker;
    if (orders === undefined) return;

    const allOrders = [...orders, ...(getPendingOrders(worker))];
    const moveOrder = allOrders.find(order => order.abilityId === Ability.MOVE);
    if (moveOrder && moveOrder.targetWorldSpacePos) {
      const intendedConstructionLocation = moveOrder.targetWorldSpacePos;

      // Find corresponding building type
      const buildingStep = [...buildingPositions.entries()].reduce(
        /**
         * @param {[number, Point2D] | null} closestEntry 
         * @param {[number, false | Point2D]} currentEntry 
         * @returns {[number, Point2D] | null}
         */
        (closestEntry, currentEntry) => {
          // If the current entry's second element is not a Point2D, return the current closestEntry.
          if (currentEntry[1] === false || typeof currentEntry[1] === 'boolean') return closestEntry;

          // If closestEntry is null or doesn't exist, return the current entry as it's guaranteed to be of type [number, Point2D].
          if (!closestEntry) return /** @type {[number, Point2D]} */(currentEntry);

          const currentDistance = getDistance(currentEntry[1], intendedConstructionLocation);
          const closestDistance = getDistance(closestEntry[1], intendedConstructionLocation);
          return currentDistance < closestDistance ? /** @type {[number, Point2D]} */(currentEntry) : closestEntry;
        },
        /** @type {[number, Point2D] | null} */(null)
      );

      if (buildingStep) {
        const stepNumber = buildingStep[0];
        const buildingType = gameState.getBuildingTypeByStepNumber(stepNumber);
        if (buildingType !== undefined) {
          const footprint = getFootprint(buildingType);
          if (footprint && 'w' in footprint && 'h' in footprint) {
            constructionGrids.push(...cellsInFootprint(createPoint2D(intendedConstructionLocation), footprint)); // Use the correct variable name
          }
        }
      }
    }

    if (worker.isConstructing() || isPendingContructing(worker)) {
      const foundOrder = allOrders.find(order => order.abilityId && constructionAbilities.includes(order.abilityId));
      if (foundOrder && foundOrder.targetWorldSpacePos) {
        // Find the unit type name associated with the found order's abilityId
        const foundUnitTypeName = Object.keys(UnitTypeMap).find(unitTypeName =>
          UnitTypeMap[unitTypeName] === foundOrder.abilityId
        );

        if (foundUnitTypeName) {
          const footprint = getFootprint(UnitTypeMap[foundUnitTypeName]);
          if (footprint && 'w' in footprint && 'h' in footprint) {
            constructionGrids.push(...cellsInFootprint(createPoint2D(foundOrder.targetWorldSpacePos), footprint));
          }
        }
      }
    }
  });

  return constructionGrids;
}

module.exports = {
  getCurrentlyEnrouteConstructionGrids,
};
