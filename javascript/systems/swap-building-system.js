//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Ability } = require("@node-sc2/core/constants");
const { liftingAbilities, landingAbilities } = require("@node-sc2/core/constants/groups");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const planService = require("../services/plan-service");
const { setPendingOrders } = require("../services/unit-service");
const { repositionBuilding } = require("../services/world-service");

module.exports = createSystem({
  name: 'SwapBuildingSystem',
  type: 'agent',
  async onStep(world) {
    const { actions, units } = world.resources.get();
    const swapBuildings = units.withLabel('swapBuilding');

    /**
     * @param {Unit} building
     * @param {AbilityId[]} abilities
     * @returns {boolean}
     */
    function hasAbility(building, abilities) {
      return building.availableAbilities().some(ability => abilities.includes(ability)) && !building.labels.has('pendingOrders');
    }

    /**
     * @param {Unit} building
     * @returns {Promise<void>}
     */
    async function liftBuilding(building) {
      const { pos, tag } = building; if (pos === undefined || tag === undefined) return;
      if (hasAbility(building, liftingAbilities) && distance(pos, building.labels.get('swapBuilding')) > 1) {
        const unitCommand = {
          abilityId: Ability.LIFT,
          unitTags: [tag],
        }
        await actions.sendAction(unitCommand);
        setPendingOrders(building, unitCommand);
      } else {
        building.labels.delete('swapBuilding');
      }
    }

    /**
     * @param {Unit} building
     * @returns {Promise<void>}
     */
    async function landBuilding(building) {
      if (hasAbility(building, landingAbilities)) {
        const { tag } = building; if (tag === undefined) return;
        const unitCommand = {
          abilityId: Ability.LAND,
          unitTags: [tag],
          targetWorldSpacePos: building.labels.get('swapBuilding')
        }
        await actions.sendAction(unitCommand);
        planService.pausePlan = false;
        setPendingOrders(building, unitCommand);
      }
    }

    // Execute lift and land actions
    for (let step = 0; step < swapBuildings.length; step++) {
      const building = swapBuildings[step];
      await liftBuilding(building);
      await landBuilding(building);
    }

    const addOnUnits = units.withLabel('addAddOn').filter(unit => {
      if (unit.pos === undefined) {
        return false;
      }

      const addAddOn = unit.labels.get('addAddOn');

      // Check if addAddOn is not null before using it
      if (addAddOn === null) {
        return false;
      }

      return distance(unit.pos, addAddOn) < 1;
    });

    // Modifying the labels
    addOnUnits.forEach(unit => {
      unit.labels.delete('addAddOn');
      console.log('deleting addAddOn label');
    });

    const collectedActions = [
      // ...setReposition(world),
      ...repositionBuilding(world),
    ];

    if (collectedActions.length > 0) {
      await actions.sendAction(collectedActions);
    }
  }
});