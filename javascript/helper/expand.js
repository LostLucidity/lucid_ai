//@ts-check
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { getAvailableExpansions } = require("./expansions");

async function expand(agent, data, resources,) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  const expansionLocation = getAvailableExpansions(resources)[0].townhallPosition;
  const townhallType = TownhallRace[agent.race][0];
  const foundPosition = await actions.canPlace(TownhallRace[agent.race][0], [expansionLocation]);
  if (foundPosition) {
    const buildAbilityId = data.getUnitTypeData(townhallType).abilityId;
    if ((units.inProgress(townhallType).length + units.withCurrentOrders(buildAbilityId).length) < 1 ) {
      await actions.build(townhallType, foundPosition);
    }
  }
}

module.exports = expand;