//@ts-check
"use strict"

// construction-utils.js inside the shared-utilities directory

const groupTypes = require("@node-sc2/core/constants/groups");
const unitService = require("../../services/unit-service");
const { MOVE } = require("@node-sc2/core/constants/ability");
const planService = require("../../services/plan-service");
const { getDistance } = require("../../services/position-service");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const { isPendingContructing } = require("../../services/shared-service");
const { UnitType } = require("@node-sc2/core/constants");

/**
 * @param {World} world
 * @returns {Point2D[]}
 */
function getCurrentlyEnrouteConstructionGrids(world) {
  const { constructionAbilities } = groupTypes;
  const { data, resources } = world;
  const { units } = resources.get();
  const contructionGrids = [];

  units.getWorkers().forEach(worker => {
    const { orders } = worker;
    if (orders === undefined) return;

    const allOrders = [...orders, ...(unitService.getPendingOrders(worker))];
    const moveOrder = allOrders.find(order => order.abilityId === MOVE);
    if (moveOrder && moveOrder.targetWorldSpacePos) {
      const intendedConstructionLocation = moveOrder.targetWorldSpacePos;

      // Find corresponding building type
      const buildingStep = [...planService.buildingPositions.entries()].reduce(
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
        const buildingType = planService.legacyPlan[buildingStep[0]][2];
        const footprint = getFootprint(buildingType);
        if (footprint && 'w' in footprint && 'h' in footprint) {
          contructionGrids.push(...cellsInFootprint(createPoint2D(intendedConstructionLocation), footprint));
        }
      }
    }

    if (worker.isConstructing() || isPendingContructing(worker)) {
      const foundOrder = allOrders.find(order => order.abilityId && constructionAbilities.includes(order.abilityId));
      if (foundOrder && foundOrder.targetWorldSpacePos) {
        const foundUnitTypeName = Object.keys(UnitType).find(unitType => data.getUnitTypeData(UnitType[unitType]).abilityId === foundOrder.abilityId);
        if (foundUnitTypeName) {
          const footprint = getFootprint(UnitType[foundUnitTypeName]);
          if (footprint && 'w' in footprint && 'h' in footprint) {
            contructionGrids.push(...cellsInFootprint(createPoint2D(foundOrder.targetWorldSpacePos), footprint));
          }
        }
      }
    }
  });

  return contructionGrids;
}

module.exports = {
  getCurrentlyEnrouteConstructionGrids
};
