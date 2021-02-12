//@ts-check
"use strict"

const { EFFECT_REPAIR, SMART } = require("@node-sc2/core/constants/ability");
const { CYCLONE, LIBERATOR, MEDIVAC, SIEGETANK, SIEGETANKSIEGED, VIKINGFIGHTER, LIBERATORAG, BUNKER } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");

module.exports = {
  repairBurningStructures: (resources) => {
    const {
      units,
    } = resources.get();
    const collectedActions = [];
    // get burning structure.
    const [ burningStructure ] = units.getStructures(structure => structure.health / structure.healthMax < 1 / 3 && structure.buildProgress);
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
  },
  repairDamagedMechUnits: (resources) => {
    const {
      units,
    } = resources.get();
    const collectedActions = [];
    // get burning structure.
    const [ damagedMechUnit ] = units.getById([ CYCLONE, LIBERATOR, LIBERATORAG, MEDIVAC, SIEGETANK, SIEGETANKSIEGED, VIKINGFIGHTER]).filter(unit => unit.health / unit.healthMax < 1 / 3);
    if (damagedMechUnit) {
      // select worker and repair stucture
      const [ closestWorker ] = units.getClosest(damagedMechUnit.pos, units.getWorkers());
      if (closestWorker) {
        const unitCommand = {
          abilityId: EFFECT_REPAIR,
          targetUnitTag: damagedMechUnit.tag,
          unitTags: [ closestWorker.tag ]
        }
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
  },
  repairBunker: (resources) => {
    const {
      units,
    } = resources.get();
    const collectedActions = [];
    // get burning structure.
    const [ damagedBunker ] = units.getById([ BUNKER ]).filter(unit => unit.health / unit.healthMax < 1 && unit.buildProgress >= 1)
    if (damagedBunker) {
      // select worker and repair stucture
      const [ closestWorker ] = units.getClosest(damagedBunker.pos, units.getWorkers());
      if (closestWorker) {
        const unitCommand = {
          abilityId: EFFECT_REPAIR,
          targetUnitTag: damagedBunker.tag,
          unitTags: [ closestWorker.tag ]
        }
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
  },
  finishAbandonedStructures: (resources) => {
    const { units } = resources.get();
    const collectedActions = [];
    const [ abandonedStructure ] = units.getStructures().filter(structure => structure.buildProgress < 1);
    if (abandonedStructure) {
      if (distance(abandonedStructure.pos, units.getClosest(abandonedStructure.pos, units.getWorkers())[0].pos) < abandonedStructure.radius + 0.25) {
        return;
      }
      let builders = [
        ...units.withLabel('builder').filter(w => !w.isConstructing()),
        ...units.withLabel('proxy').filter(w => !w.isConstructing()),
      ];
      if (builders.length === 0) {
        builders.push(
          ...units.getMineralWorkers(),
          ...units.getWorkers().filter(w => w.noQueue)
        );
      }
      const [ builder ] = units.getClosest(abandonedStructure.pos, builders);
      if (builder) {
        builder.labels.set('builder', true);
        if (builder) {
          const unitCommand = {
            abilityId: SMART,
            unitTags: [ builder.tag ],
            targetUnitTag: abandonedStructure.tag,
          };
          collectedActions.push(unitCommand);
        }
      }
    }
    return collectedActions;
  }
}