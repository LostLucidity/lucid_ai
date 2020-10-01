const { MOVE } = require("@node-sc2/core/constants/ability");
//@ts-check
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { workerSendOrBuild } = require("../builds/protoss/helper");
const canAfford = require("./can-afford");
const { getAvailableExpansions } = require("./expansions");

async function expand(agent, data, resources) {
  const {
    actions,
    units,
  } = resources.get();
  const collectedActions = [];
  const expansionLocation = getAvailableExpansions(resources)[0].townhallPosition;
  const townhallType = TownhallRace[agent.race][0];
  if (canAfford(agent, data, townhallType)) {
    const foundPosition = await actions.canPlace(TownhallRace[agent.race][0], [expansionLocation]);
    if (foundPosition) {
      const buildAbilityId = data.getUnitTypeData(townhallType).abilityId;
      if ((units.inProgress(townhallType).length + units.withCurrentOrders(buildAbilityId).length) < 1 ) {
        collectedActions.push(...workerSendOrBuild(units, data.getUnitTypeData(townhallType).abilityId, expansionLocation));
      }
    }
  } else {
    collectedActions.push(...workerSendOrBuild(units, MOVE, expansionLocation));
  }
  return collectedActions;
}

module.exports = expand;