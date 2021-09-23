//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { REACTOR } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { findPosition } = require("../../helper/placement/placement-helper");
const { getAddOnBuildingPlacement, getAddOnPlacement } = require("../../helper/placement/placement-utilities");
const { getStringNameOfConstant } = require("../../services/logging-service");

module.exports = {
  handleOrphanReactor: () => {
    // find orphan reactors
  },
  checkAddOnPlacement: async ({ data, resources }, building, addOnType = REACTOR) => {
    const { map } = resources.get();
    const abilityId = data.getUnitTypeData(addOnType).abilityId;
    if (building.abilityAvailable(abilityId)) {
      let position = null;
      let addOnPosition = null;
      let range = 1;
      do {
        const nearPoints = gridsInCircle(getAddOnPlacement(building.pos), range).filter(grid => map.isPlaceableAt(addOnType, grid) && map.isPlaceableAt(building.unitType, getAddOnBuildingPlacement(grid)));
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
