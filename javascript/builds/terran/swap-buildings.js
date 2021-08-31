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
  removeLabelsWhenInTargetRange: (buildings, label) => {
    buildings.forEach((building) => {
      if (building.orders.length > 0) {
        const foundOrder = building.orders.find(order => landingAbilities.includes(order.abilityId));
        if (foundOrder && foundOrder.targetWorldSpacePos && distance(building.pos, foundOrder.targetWorldSpacePos) < 1) {
          console.log('remove label', label);
          building.labels.delete(label);
        }
      }
    });
  },
  swapBuildings: async (world, conditions = []) => {
    // get first building, if addon get building offset
    const { actions, units } = world.resources.get();
    const label = 'swapBuilding';
    let buildingsToSwap = [...conditions].map((condition, index) => {
      const addOnValue = `addOn${index}`;
      const unitType = condition[0];
      let [building] = units.withLabel(label).filter(unit => unit.labels.get(label) === index);
      if (!checkBuildingCount(world, unitType, condition[1]) && !building) { return };
      let [addOn] = units.withLabel(label).filter(unit => unit.labels.get(label) === addOnValue);
      if (!building) {
        if (addonTypes.includes(unitType)) {
          [addOn] = addOn ? [addOn] : units.getById(unitType).filter(unit => unit.buildProgress >= 1);
          const [building] = addOn ? units.getClosest(getAddOnBuildingPosition(addOn.pos), units.getStructures()) : [];
          if (addOn && building) {
            addOn.labels.set(label, addOnValue);
            building.labels.set(label, index);
            return building;
          }
        } else {
          const [building] = units.getById(countTypes.get(unitType)).filter(unit => unit.noQueue && (unit.addOnTag === '0' || unit.addOnTag === 0) && unit.buildProgress >= 1);
          if (building) {
            building.labels.set(label, index);
            return building;
          }
        }
      } else {
        return building;
      }
    });
    if (buildingsToSwap.every(building => building)) {
      if (buildingsToSwap.every(building => building.noQueue && !building.labels.has('pendingOrders'))) {
        if (buildingsToSwap.every(building => building.availableAbilities().find(ability => liftingAbilities.includes(ability)))) {
          await actions.do(Ability.LIFT, buildingsToSwap[0].tag);
          await actions.do(Ability.LIFT, buildingsToSwap[1].tag);
        }
        if (buildingsToSwap.every(building => building.availableAbilities().find(ability => landingAbilities.includes(ability)))) {
          await actions.do(Ability.LAND, buildingsToSwap[0].tag, { target: buildingsToSwap[1].pos });
          await actions.do(Ability.LAND, buildingsToSwap[1].tag, { target: buildingsToSwap[0].pos });
        }
      }
      module.exports.removeLabelsWhenInTargetRange(units.withLabel(label), label);
    } else {
      units.withLabel(label).forEach((building) => {
        building.labels.delete(label);
      });
    }
  },
  checkAddOnPlacement: async ({ data, resources }, building, addOnType = REACTOR) => {
    const { map } = resources.get();
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
