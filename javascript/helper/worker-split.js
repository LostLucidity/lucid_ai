//@ts-check
"use strict"

const { HARVEST_GATHER } = require("@node-sc2/core/constants/ability");

async function workerSplit(resources) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  const collectedActions = [];
  const workers = units.getWorkers();
  const [main] = map.getExpansions();
  const mainMineralField = units.getClosest(main.townhallPosition, units.getMineralFields(), 8);
  workers.forEach((worker, index) => {
    const mineralIndex = index % 8;
    const target = mainMineralField[mineralIndex];
    const unitCommand = {
      abilityId: HARVEST_GATHER,
      targetUnitTag: target.tag,
      unitTags: [ worker.tag ]
    }
    collectedActions.push(unitCommand);
  });
  actions.sendAction(collectedActions);

}

module.exports = workerSplit;