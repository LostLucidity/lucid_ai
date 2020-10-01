//@ts-check
"use strict"

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
  workerSendOrBuild: (units, ability, position) => {
    const collectedActions = [];
    const builders = [
      ...units.getMineralWorkers(),
      ...units.getWorkers().filter(w => w.noQueue),
      ...units.withLabel('builder').filter(w => !w.isConstructing()),
      ...units.withLabel('proxy').filter(w => !w.isConstructing()),
    ];
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