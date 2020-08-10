//@ts-check
const { TownhallRace } = require("@node-sc2/core/constants/race-map");

async function expand(agent, data, resources,) {
  const { foodUsed } = agent;
  const {
    actions,
    map,
    units,
  } = resources.get();
  const expansionLocation = map.getAvailableExpansions()[0].townhallPosition;
  const townhallType = TownhallRace[agent.race][0];
  const foundPosition = await actions.canPlace(TownhallRace[agent.race][0], [expansionLocation]);
  const buildAbilityId = data.getUnitTypeData(townhallType).abilityId;
  if ((units.inProgress(townhallType).length + units.withCurrentOrders(buildAbilityId).length) < 1 ) {
    return actions.build(townhallType, foundPosition);
  }
}

module.exports = expand;