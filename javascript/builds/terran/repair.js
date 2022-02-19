//@ts-check
"use strict"

const { EFFECT_REPAIR, SMART } = require("@node-sc2/core/constants/ability");
const { Alliance, Attribute } = require("@node-sc2/core/constants/enums");
const { addonTypes } = require("@node-sc2/core/constants/groups");
const { BUNKER } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { isPendingContructing } = require("../../services/shared-service");

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
  /**
   * @param {ResourceManager} resources 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  repairDamagedMechUnits: (resources) => {
    const { units, } = resources.get();
    const collectedActions = [];
    const [ damagedMechanicalUnit ] = units.getAlive(Alliance.SELF).filter(unit => unit.data().attributes.includes(Attribute.MECHANICAL) && unit.health / unit.healthMax < 1 / 3);
    if (damagedMechanicalUnit) {
      const [closestWorker] = units.getClosest(damagedMechanicalUnit.pos, units.getWorkers()
        .filter(worker => {
          return (
            worker.tag !== damagedMechanicalUnit.tag &&
            !worker.isConstructing() &&
            !isPendingContructing(worker) &&
            distance(worker.pos, damagedMechanicalUnit.pos) <= 16
          )
        }));
      if (closestWorker) {
        const unitCommand = {
          abilityId: EFFECT_REPAIR,
          targetUnitTag: damagedMechanicalUnit.tag,
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
    const [ abandonedStructure ] = units.getStructures().filter(structure => structure.buildProgress < 1 && addonTypes.indexOf(structure.unitType) === -1);
    if (abandonedStructure) {
      if (distance(abandonedStructure.pos, units.getClosest(abandonedStructure.pos, units.getWorkers())[0].pos) < abandonedStructure.radius + 0.30) {
        return collectedActions;
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