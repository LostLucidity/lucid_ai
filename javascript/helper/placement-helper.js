//@ts-check
"use strict"

const { distance, add } = require('@node-sc2/core/utils/geometry/point');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');
const { Alliance } = require('@node-sc2/core/constants/enums');
const { UnitType } = require('@node-sc2/core/constants');
const { flyingTypesMapping } = require('./groups');

module.exports = {
  findPosition: async (actions, unitType, candidatePositions) => {
    if (flyingTypesMapping.has(unitType)) { unitType = flyingTypesMapping.get(unitType); }
    const randomPositions = candidatePositions
      .map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);
    const foundPosition = await actions.canPlace(unitType, randomPositions);
    const unitTypeName = Object.keys(UnitType).find(type => UnitType[type] === unitType);
    if (unitTypeName) {
      console.log(`FoundPosition for ${unitTypeName}`, foundPosition);
    }
    return foundPosition;
  },
  findSupplyPositions: () => {
    const { map } = this.resources.get();
    const myExpansions = map.getOccupiedExpansions(Alliance.SELF);
    // front of natural pylon for great justice
    const naturalWall = map.getNatural().getWall();
    let possiblePlacements = frontOfGrid(this.resources, map.getNatural().areas.areaFill)
        .filter(point => naturalWall.every(wallCell => (
            (distance(wallCell, point) <= 6.5) &&
            (distance(wallCell, point) >= 3)
        )));
  
    if (possiblePlacements.length <= 0) {
        possiblePlacements = frontOfGrid(this.resources, map.getNatural().areas.areaFill)
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
  getBetweenBaseAndWall: async (resources, unitType) => {
    const { actions, map } = resources.get();
    const pathCandidates = map.path(add(map.getNatural().townhallPosition, 3), add(map.getEnemyMain().townhallPosition, 3)).slice(0, 10).map(pathItem => ({ 'x': pathItem[0], 'y': pathItem[1] }));
    return [ await actions.canPlace(unitType, pathCandidates) ];
  },
  inTheMain: async (resources, unitType) => {
    const { actions, map } = resources.get();
    const candidatePositions = map.getMain().areas.areaFill
    return [ await actions.canPlace(unitType, candidatePositions) ];
  }
}