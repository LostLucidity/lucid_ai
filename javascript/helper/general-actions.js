//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { workerSendOrBuild } = require("../builds/protoss/helper");
const canAfford = require("./can-afford");
const { getAvailableExpansions, getNextSafeExpansion } = require("./expansions");

module.exports = {
  expand: async (agent, data, resources, state) => {
    let collectedActions = [];
    const { actions, units } = resources.get();
    const availableExpansions = getAvailableExpansions(resources);
    const expansionLocation = availableExpansions.length > 0 ? getNextSafeExpansion(resources, availableExpansions).townhallPosition : null;
    if (expansionLocation) {
      const townhallType = TownhallRace[agent.race][0];
      if (canAfford(agent, data, townhallType)) {
        const foundPosition = await actions.canPlace(TownhallRace[agent.race][0], [expansionLocation]);
        if (foundPosition) {
          const buildAbilityId = data.getUnitTypeData(townhallType).abilityId;
          if ((units.inProgress(townhallType).length + units.withCurrentOrders(buildAbilityId).length) < 1 ) {
            await actions.sendAction(workerSendOrBuild(units, data.getUnitTypeData(townhallType).abilityId, expansionLocation));
            state.pauseBuilding = false;
          }
        }
      } else {
        collectedActions.push(...workerSendOrBuild(units, MOVE, expansionLocation));
        state.pauseBuilding = true;
        state.continueBuild = false;
      }
    }
  }
}