//@ts-check
"use strict"

const { CANCEL_QUEUE5, LIFT, LAND } = require("@node-sc2/core/constants/ability");
const { BARRACKSREACTOR, REACTOR } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { findPosition } = require("../../helper/placement-helper");

module.exports = {
  handleOrphanReactor: () => {
    // find orphan reactors
  },
  swapBuildings: async (resources, conditions) => {
    const { actions, units } = resources.get();
    let firstBuildingTypes = units.getById(conditions[0].buildings).filter(building => building[conditions[0].addOn]() && building.abilityAvailable(conditions[0].liftAbility));
    firstBuildingTypes.push(...units.getById(conditions[0].buildings).filter(building => building.abilityAvailable(conditions[0].landAbility)));
    const secondBuildingTypes = units.getById(conditions[1].buildings).filter(building => building.buildProgress >= 1)
    if (firstBuildingTypes.length === conditions[0].count && secondBuildingTypes.length === conditions[1].count) {
      const [ firstBuilding ] = firstBuildingTypes;
      const [ secondBuilding ] = units.getClosest(firstBuilding.pos, secondBuildingTypes.filter(building => building.addOnTag === '0'));
      if (firstBuilding && secondBuilding) {
        const buildings = [ firstBuilding, secondBuilding];
        for (let step = 0; step < buildings.length; step++) {
          const building = buildings[step];
          if (building.abilityAvailable(CANCEL_QUEUE5)) {
            const unitCommand = {
              abilityId: CANCEL_QUEUE5,
              unitTags: [ building.tag ],
            }
            await actions.sendAction(unitCommand); 
          };
          if (building.abilityAvailable(conditions[step].liftAbility)) {
            try { await actions.do(conditions[step].liftAbility, building.tag); } catch(error) { console.log(error); }
          }
          const reverseStep = buildings.length - 1;
          if (building.abilityAvailable(conditions[step].landAbility) && building.isIdle()) {
            // building position for first building should be based on it's addon.
            console.log(firstBuilding.pos);
            const [ addOnTarget ] = units.getClosest({x: firstBuilding.pos.x + 2.5, y: firstBuilding.pos.y -0.5}, units.getStructures());
            firstBuilding.landingTarget =  { x: addOnTarget.pos.x - 2.5, y: addOnTarget.pos.y + 0.5 };
            secondBuilding.landingTarget = secondBuilding.pos;
            console.log(firstBuilding.landingTarget);
            try { await actions.do(conditions[step].landAbility, building.tag, { target: buildings[reverseStep - step].landingTarget, queue: true }); } catch(error) { console.log(error); }
          }
        }
      }
    }
  },
  checkAddOnPlacement: async ({ data, resources }, building, unitTypeAddOn = REACTOR) => {
    const { actions } = resources.get();
    const abilityId = data.getUnitTypeData(unitTypeAddOn).abilityId;
    if (building.abilityAvailable(abilityId)) {
      let foundPosition = null;
      let range = 4;
      do {
        const nearPoints = gridsInCircle(building.pos, range);
        foundPosition = await findPosition(actions, BARRACKSREACTOR, nearPoints);
        range++
      } while (!foundPosition);
      return foundPosition;
    } else {
      return;
    }
  }
}
