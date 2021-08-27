//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { UnitType } = require("@node-sc2/core/constants");
const { CANCEL_QUEUE5 } = require("@node-sc2/core/constants/ability");

module.exports = createSystem({
  name: 'ClearQueueSystem',
  type: 'agent',
  async onStep({resources}) {
    const { actions, units } = resources.get();
    // get production units and check their queue.length > 1 and nonreactor
    const collectedActions = [];
    Object.values(UnitType).some(unitType => {
      const queuedTrainers = units.getProductionUnits(unitType).filter(unit => unit.isStructure() && unit.orders.length > 1 && !unit.hasReactor());
      if (queuedTrainers.length > 0 && queuedTrainers[0].abilityAvailable(CANCEL_QUEUE5)) {
        collectedActions.push({
          abilityId: CANCEL_QUEUE5,
          unitTags: [queuedTrainers[0].tag],
        });
        return true;
      }
    });
    await actions.sendAction(collectedActions);
  }
})