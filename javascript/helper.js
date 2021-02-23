//@ts-check
"use strict"

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
  getSupply: (units, data) => {
    return units.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
  },
  workerSendOrBuild: (units, ability, position) => {
    const collectedActions = [];
    let builders = [
      ...units.withLabel('builder').filter(w => !w.isConstructing() && !w.isAttacking()),
      ...units.withLabel('proxy').filter(w => !w.isConstructing() && !w.isAttacking()),
    ];
    if (ability !== MOVE || builders.length === 0) {
      builders.push(
        ...units.getMineralWorkers(),
        ...units.getWorkers().filter(w => w.noQueue)
      );
    }
    const [ builder ] = units.getClosest(position, builders);
    if (builder) {
      builder.labels.set('builder', true);
      if (builder) {
        const unitCommand = {
          abilityId: ability,
          unitTags: [builder.tag],
          targetWorldSpacePos: position,
        };
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
  }
}