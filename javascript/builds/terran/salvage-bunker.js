//@ts-check
"use strict"

const { EFFECT_SALVAGE, UNLOADALL_BUNKER } = require("@node-sc2/core/constants/ability");
const { BUNKER } = require("@node-sc2/core/constants/unit-type");

module.exports = {
  salvageBunker: (units) => {
    const collectedActions = [];
    // get bunker
    const [ bunker ] = units.getByType(BUNKER);
    if (bunker) {
      let abilityIds = [ EFFECT_SALVAGE ];
      if (bunker.abilityAvailable(UNLOADALL_BUNKER)) {
        abilityIds.push(UNLOADALL_BUNKER);
      }
      abilityIds.forEach(abilityId => {
        const unitCommand = {
          abilityId: abilityId,
          unitTags: [ bunker.tag ]
        }
        collectedActions.push(unitCommand)
      })
    }
    return collectedActions;
  }
} 