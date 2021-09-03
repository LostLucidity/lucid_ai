//@ts-check
"use strict"

const Ability = require("@node-sc2/core/constants/ability");
const { addonTypes, liftingAbilities, landingAbilities } = require("@node-sc2/core/constants/groups");
const { REACTOR } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { checkBuildingCount } = require("../../helper");
const { countTypes } = require("../../helper/groups");
const { findPosition } = require("../../helper/placement/placement-helper");
const { getAddOnBuildingPosition, getAddOnPosition, getAddOnBuildingPlacement } = require("../../helper/placement/placement-utilities");

module.exports = {
  handleOrphanReactor: () => {
    // find orphan reactors
  },
  checkAddOnPlacement: async ({ data, resources }, building, addOnType = REACTOR) => {
    const { actions, map } = resources.get();
    const abilityId = data.getUnitTypeData(addOnType).abilityId;
    if (building.abilityAvailable(abilityId)) {
      let position = null;
      let addOnPosition = null;
      let range = 1;
      do {
        const nearPoints = gridsInCircle(getAddOnPosition(building.pos), range).filter(grid => map.isPlaceableAt(addOnType, grid) && map.isPlaceableAt(building.unitType, getAddOnBuildingPosition(grid)));
        if (nearPoints.length > 0) {
          if (Math.random() < (1 / 2)) {
            addOnPosition = nearPoints[Math.floor(Math.random() * nearPoints.length)];
            position = getAddOnBuildingPlacement(addOnPosition);
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
