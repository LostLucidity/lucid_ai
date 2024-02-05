const { UnitType } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const { findPosition } = require("./buildingPlacementHelpers");
const { existsInMap, pointsOverlap } = require("../common/mapUtils");
const { getAddOnPlacement, getAddOnBuildingPlacement } = require("../common/placementUtils");
const { canUnitBuildAddOn, flyingTypesMapping } = require("../common/unitConfig");
const { getStringNameOfConstant } = require("../common/utils");

/** @type {Point2D[]} */
const seigeTanksSiegedGrids = [];

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
  const { unitType, pos } = building;

  // Ensure unitType and pos are defined
  if (unitType === undefined || pos === undefined) {
    console.error("checkAddOnPlacement: Missing unit type or position.");
    return;
  }

  if (canUnitBuildAddOn(unitType)) {
    let position = null;
    let addOnPosition = null;
    let range = 1;

    do {
      const nearPoints = gridsInCircle(getAddOnPlacement(pos), range).filter(grid => {
        const addOnFootprint = getFootprint(addOnType);
        if (!addOnFootprint) return false; // Ensure addOnFootprint is defined

        const addOnBuildingPlacementsForOrphanAddOns = units.getStructures(Alliance.SELF).reduce((/** @type {Point2D[]} */acc, structure) => {
          if (typeof structure.unitType === 'number' && [REACTOR, TECHLAB].includes(structure.unitType) && structure.pos) {
            return [...acc, ...cellsInFootprint(getAddOnBuildingPlacement(structure.pos), { h: 3, w: 3 })];
          }
          return acc;
        }, []);

        const getBuildingAndAddOnPlacement = [
          ...cellsInFootprint(grid, addOnFootprint),
          ...cellsInFootprint(getAddOnBuildingPlacement(grid), { h: 3, w: 3 })
        ];

        return [
          existsInMap(map, grid) && map.isPlaceableAt(addOnType, grid) && map.isPlaceableAt(flyingTypesMapping.get(unitType) || unitType, getAddOnBuildingPlacement(grid)),
          !pointsOverlap(getBuildingAndAddOnPlacement, [...seigeTanksSiegedGrids, ...addOnBuildingPlacementsForOrphanAddOns]),
        ].every(condition => condition);
      });
      if (nearPoints.length > 0) {
        if (Math.random() < (1 / 2)) {
          addOnPosition = nearPoints[Math.floor(Math.random() * nearPoints.length)];
          console.log(`isPlaceableAt for ${getStringNameOfConstant(UnitType, addOnType)}`, addOnPosition);
          position = getAddOnBuildingPlacement(addOnPosition);
          console.log(`isPlaceableAt for ${getStringNameOfConstant(UnitType, building.unitType)}`, position);
        } else {
          addOnPosition = findPosition(world, addOnType, nearPoints);
          if (addOnPosition) {
            if (typeof building.unitType === 'number') {
              position = findPosition(world, building.unitType, [getAddOnBuildingPlacement(addOnPosition)]);
            } else {
              console.error('checkAddOnPlacement: building.unitType is undefined');
            }
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

// Export the shared functionalities
module.exports = {
  seigeTanksSiegedGrids,
  checkAddOnPlacement,
};
