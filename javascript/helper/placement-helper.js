//@ts-check
"use strict"

const { distance, avgPoints } = require('@node-sc2/core/utils/geometry/point');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');

const { Alliance } = require('@node-sc2/core/constants/enums');
const { gridsInCircle } = require('@node-sc2/core/utils/geometry/angle');

module.exports = {
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
    const natural = map.getNatural();
    const naturalWall = natural.getWall();
    const avg = avgPoints(naturalWall);
    const avgWallAndNatural = avgPoints([avg, natural.townhallPosition]);
    const nearPoints = gridsInCircle(avgWallAndNatural, 4);
    const sampledPoints = nearPoints
      .map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);
    return await actions.canPlace(unitType, sampledPoints);
  }
}