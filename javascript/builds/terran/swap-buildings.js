//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { REACTOR, SIEGETANKSIEGED } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { existsInMap } = require("../../helper/location");
const { findPosition } = require("../../helper/placement/placement-helper");
const { getAddOnBuildingPlacement, getAddOnPlacement } = require("../../helper/placement/placement-utilities");
const { intersectionOfPoints } = require("../../helper/utilities");
const { getStringNameOfConstant } = require("../../services/logging-service");
const worldService = require("../../services/world-service");

module.exports = {
  handleOrphanReactor: () => {
    // find orphan reactors
  },
  /**
   * 
   * @param {World} world 
   * @param {Unit} building 
   * @param {UnitTypeId} addOnType 
   * @returns 
   */
  checkAddOnPlacement: async (world, building, addOnType = REACTOR) => {
    const { data, resources } = world;
    const { map, units } = resources.get();
    const abilityIds = worldService.getAbilityIdsForAddons(data, addOnType);
    if (abilityIds.some(abilityId => building.abilityAvailable(abilityId))) {
      let position = null;
      let addOnPosition = null;
      let range = 1;
      do {
        const nearPoints = gridsInCircle(getAddOnPlacement(building.pos), range).filter(grid => {
          const seigeTanksSiegedGrids = []
          units.getById(SIEGETANKSIEGED).forEach(unit => {
            seigeTanksSiegedGrids.push(...gridsInCircle(unit.pos, unit.radius, { normalize: true }))
          });
          return [
            existsInMap(map, grid),
            map.isPlaceableAt(addOnType, grid) && map.isPlaceableAt(building.unitType, getAddOnBuildingPlacement(grid)),
            intersectionOfPoints(cellsInFootprint(grid, getFootprint(addOnType)), seigeTanksSiegedGrids).length === 0,
          ].every(condition => condition);
        });
        if (nearPoints.length > 0) {
          if (Math.random() < (1 / 2)) {
            addOnPosition = nearPoints[Math.floor(Math.random() * nearPoints.length)];
            console.log(`isPlaceableAt for ${getStringNameOfConstant(UnitType, addOnType)}`, addOnPosition);
            position = getAddOnBuildingPlacement(addOnPosition);
            console.log(`isPlaceableAt for ${getStringNameOfConstant(UnitType, building.unitType)}`, position);
          } else {
            addOnPosition = await findPosition(resources, addOnType, nearPoints);
            if (addOnPosition) {
              position = await findPosition(resources, building.unitType, [getAddOnBuildingPlacement(addOnPosition)]);
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
}
