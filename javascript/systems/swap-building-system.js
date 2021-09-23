//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Ability } = require("@node-sc2/core/constants");
const { liftingAbilities, landingAbilities } = require("@node-sc2/core/constants/groups");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { setPendingOrders } = require("../helper");
const planService = require("../services/plan-service");
const sharedService = require("../services/shared-service");

module.exports = createSystem({
  name: 'SwapBuildingSystem',
  type: 'agent',
  async onStep(world) {
    const { actions, units } = world.resources.get();
    sharedService.removePendingOrders(units);
    const swapBuildings = units.withLabel('swapBuilding');
    for (let step = 0; step < swapBuildings.length; step++) {
      const building = swapBuildings[step];
      if (building.availableAbilities().find(ability => liftingAbilities.includes(ability)) && !building.labels.has('pendingOrders')) {
        if (distance(building.pos, building.labels.get('swapBuilding')) > 1) {
          const unitCommand = {
            abilityId: Ability.LIFT,
            unitTags: [building.tag],
          }
          await actions.sendAction(unitCommand);
          setPendingOrders(building, unitCommand);
        } else {
          building.labels.delete('swapBuilding');
        }
      }
      if (building.availableAbilities().find(ability => landingAbilities.includes(ability))) {
        const unitCommand = {
          abilityId: Ability.LAND,
          unitTags: [building.tag],
          targetWorldSpacePos: building.labels.get('swapBuilding')
        }
        await actions.sendAction(unitCommand);
        planService.pausePlan = false;
        setPendingOrders(building, unitCommand);
      }
    }
  }
})