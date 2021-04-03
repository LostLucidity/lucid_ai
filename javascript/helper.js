//@ts-check
"use strict"

const Ability = require('@node-sc2/core/constants/ability');
const { MOVE } = require('@node-sc2/core/constants/ability');
const { Alliance } = require('@node-sc2/core/constants/enums');
const { distance } = require('@node-sc2/core/utils/geometry/point');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');

module.exports = {
  findSupplyPositions: (resources) => {
    const { map } = resources.get();
    const myExpansions = map.getOccupiedExpansions(Alliance.SELF);
    // front of natural pylon for great justice
    const naturalWall = map.getNatural().getWall();
    let possiblePlacements = frontOfGrid({ resources }, map.getNatural().areas.areaFill)
        .filter(point => naturalWall.every(wallCell => (
            (distance(wallCell, point) <= 6.5) &&
            (distance(wallCell, point) >= 3)
        )));
  
    if (possiblePlacements.length <= 0) {
        possiblePlacements = frontOfGrid({ resources }, map.getNatural().areas.areaFill)
            .map(point => {
                point.coverage = naturalWall.filter(wallCell => (
                    (distance(wallCell, point) <= 6.5) &&
                    (distance(wallCell, point) >= 1)
                )).length;
                return point;
            })
            .sort((a, b) => b.coverage - a.coverage)
            .filter((cell, i, arr) => cell.coverage === arr[0].coverage);
    }
  
    return possiblePlacements;
  },
  getTrainingSupply: (unitTypes, data, units) => {
    const trainingUnitTypes = [];
    unitTypes.forEach(type => {
      let abilityId = data.getUnitTypeData(type).abilityId;
      trainingUnitTypes.push(...units.withCurrentOrders(abilityId).map(() => type));
    });
    return trainingUnitTypes.map(unitType => data.getUnitTypeData(unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
  },
  getSupply: (data, units) => {
    return units.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
  },
  workerSendOrBuild: (resources, abilityId, position) => {
    const { frame, units } = resources.get();
    const collectedActions = [];
    let builders = [
      ...units.withLabel('builder').filter(builder => getLabelledAvailable(builder)),
      ...units.withLabel('proxy').filter(proxy => getLabelledAvailable(proxy)),
    ].filter(worker => !worker.isReturning());
    if (ability !== MOVE || builders.length === 0) {
    console.log('builders.length', builders.length);
      builders.push(
        ...units.getWorkers().filter(worker => worker.noQueue || worker.isGathering())
      );
      console.log('builders.length', builders.length);
    }
    const [ builder ] = units.getClosest(position, builders);
    if (builder) {
      console.log(frame.timeInSeconds(), `Command given: ${Object.keys(Ability).find(ability => Ability[ability] === abilityId)}, builder.tag: ${builder.tag}, builder.isAttacking(): ${builder.isAttacking()}`);
      builder.labels.set('builder', true);
      const unitCommand = {
        abilityId: abilityId,
        unitTags: [builder.tag],
        targetWorldSpacePos: position,
        queue: builder.isConstructing() ? true : false,
      };
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  }

}

function getLabelledAvailable(labelled) {
  console.log(
    'getLabelledAvailable',
    !labelled.isConstructing(),
    (labelled.isConstructing() && labelled.unitType === PROBE),
    !labelled.isAttacking(),
    (!labelled.isConstructing() || (labelled.isConstructing() && labelled.unitType === PROBE)) && !labelled.isAttacking(),
  );
  return (!labelled.isConstructing() || (labelled.isConstructing() && labelled.unitType === PROBE)) && !labelled.isAttacking()
} 