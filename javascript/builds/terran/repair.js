//@ts-check
"use strict"

const { EFFECT_REPAIR } = require("@node-sc2/core/constants/ability");

module.exports = {
  repairBurningStructures: (resources) => {
    const {
      units,
    } = resources.get();
    const collectedActions = [];
    // get burning structure.
    const [ burningStructure ] = units.getStructures(structure => structure.health / structure.healthMax < 1 / 3);
    if (burningStructure) {
      // select worker and repair stucture
      const builders = [
        ...units.getMineralWorkers(),
        ...units.getWorkers().filter(w => w.noQueue),
        ...units.withLabel('builder').filter(w => !w.isConstructing()),
      ];
      const [ closestWorker ] = units.getClosest(burningStructure.pos, builders);
      if (closestWorker) {
        const unitCommand = {
          abilityId: EFFECT_REPAIR,
          targetUnitTag: burningStructure.tag,
          unitTags: [ closestWorker.tag ]
        }
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
  }
}