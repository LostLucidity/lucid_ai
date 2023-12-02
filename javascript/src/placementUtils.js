//@ts-check
"use strict"

// src/placementUtils.js

const groupTypes = require("@node-sc2/core/constants/groups");
const { UnitType } = require("@node-sc2/core/constants");
const { getDistance, getClosestPosition } = require("./geometryUtils");
const GameState = require("./gameState");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const MapResources = require("./mapResources");
const { getAvailableExpansions } = MapResources;
const { getNextSafeExpansions, dbscan } = require("./mapUtils");

/**
 * Calculates the placement for an add-on structure based on the main building's position.
 * @param {Point2D} position - The position of the main building.
 * @returns {Point2D} - The calculated position for the add-on.
 */
const getAddOnPlacement = (position) => {
  const { x, y } = position;
  if (x === undefined) return position;
  return { x: x + 3, y: y };
};

/**
 * Calculates the placement for an add-on building based on the main building's position.
 * @param {Point2D} position - The position of the main building.
 * @returns {Point2D} - The calculated position for the add-on building.
 */
function getAddOnBuildingPlacement(position) {
  if (typeof position.x === 'number' && typeof position.y === 'number') {
    return { x: position.x - 3, y: position.y };
  } else {
    console.error('Invalid position provided for add-on building placement');
    return { x: 0, y: 0 }; // Default Point2D
  }
}

/**
 * @param {UnitResource} units
 * @returns {Point2D[]}
 */
function getBuildingFootprintOfOrphanAddons(units) {
  const orphanAddons = units.getById([UnitType.TECHLAB, UnitType.REACTOR]);
  const buildingFootprints = [];
  orphanAddons.forEach(addon => {
    if (addon.pos) { // Ensure addon.pos is defined
      const addonPlacement = getAddOnBuildingPlacement(addon.pos);
      if (addonPlacement) { // Additional check if getAddOnBuildingPlacement returns a valid value
        buildingFootprints.push(...cellsInFootprint(createPoint2D(addonPlacement), { w: 3, h: 3 }));
      }
    }
  });
  return buildingFootprints;
}

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 * @returns {Point2D[]}
 */
function findZergPlacements(world, unitType) {
  const gameState = GameState.getInstance();
  const { townhallTypes } = groupTypes;
  const { resources } = world;
  const { map, units } = resources.get();
  const candidatePositions = [];
  if (townhallTypes.includes(unitType)) {
    // Use the getter to fetch the available expansions (assuming you have a getter for it).
    let availableExpansions = getAvailableExpansions(resources);

    // If the availableExpansions is empty, fetch them using getAvailableExpansions and then set them using the setter
    if (!availableExpansions || availableExpansions.length === 0) {
      availableExpansions = getAvailableExpansions(resources);
      gameState.setAvailableExpansions(availableExpansions);
    }

    // Now use the availableExpansions in the rest of your code
    candidatePositions.push(getNextSafeExpansions(world, availableExpansions)[0]);
  } else {
    const structures = units.getStructures();
    const mineralLinePoints = map.getExpansions().flatMap(expansion => expansion.areas && expansion.areas.mineralLine || []);
    /**
     * @param {Point2D} point
     * @returns {void}
     */
    const processPoint = (point) => {
      const point2D = createPoint2D(point);
      const [closestStructure] = units.getClosest(point2D, structures);
      if (closestStructure.pos && getDistance(point2D, closestStructure.pos) <= 12.5) {
        const [closestMineralLine] = getClosestPosition(point2D, mineralLinePoints);
        if (getDistance(point2D, closestMineralLine) > 1.5 && getDistance(point2D, closestStructure.pos) > 3) {
          candidatePositions.push(point2D);
        }
      }
    };
    if (unitType !== UnitType.NYDUSCANAL) {
      const creepClusters = dbscan(map.getCreep());
      creepClusters.forEach(processPoint);
    } else {
      map.getVisibility().forEach(processPoint);
    }
  }
  return candidatePositions;
}

// Export the shared functionalities
module.exports = {
  getAddOnPlacement,
  getAddOnBuildingPlacement,
  getBuildingFootprintOfOrphanAddons,
  findZergPlacements,
};
