//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Ability } = require("@node-sc2/core/constants");
const { liftingAbilities, landingAbilities } = require("@node-sc2/core/constants/groups");
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
      if (building.availableAbilities().find(ability => liftingAbilities.includes(ability)) && (!building['pendingOrders'] || !building['pendingOrders'].length)) {
        building.labels.set('addAddOn');
        const unitCommand = {
          abilityId: Ability.LIFT,
          unitTags: [building.tag],
        }
        await actions.sendAction(unitCommand);
        setPendingOrders(building, unitCommand);
      }
      if (building.availableAbilities().find(ability => landingAbilities.includes(ability))) {
        const unitCommand = {
          abilityId: Ability.LAND,
          unitTags: [building.tag],
          targetWorldSpacePos: building.labels.get('swapBuilding')
        }
        await actions.sendAction(unitCommand);
        planService.pauseBuilding = false;
        setPendingOrders(building, unitCommand);
        building.labels.delete('addAddOn');
      }
    }
  }
})