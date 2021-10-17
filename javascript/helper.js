//@ts-check
"use strict"

const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { distance } = require('@node-sc2/core/utils/geometry/point');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');
const { countTypes } = require('./helper/groups');

const helper = {
  /**
   * Returns boolean on whether build step should be executed.
   * @param {World} world 
   * @param {UnitTypeId} unitType 
   * @param {number} targetCount 
   * @returns {boolean}
   */
  checkBuildingCount: (world, unitType, targetCount) => {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const { abilityId } = data.getUnitTypeData(unitType);
    const unitsWithOrder = units.withCurrentOrders(abilityId);
    let count = unitsWithOrder.length;
    const unitTypes = countTypes.get(unitType) ? countTypes.get(unitType) : [unitType];
    unitTypes.forEach(type => {
      let unitsToCount = units.getById(type);
      if (agent.race === Race.TERRAN) {
        unitsToCount = unitsToCount.filter(unit => unit.buildProgress >= 1);
      }
      count += unitsToCount.length;
    });
    return count === targetCount;
  },
  findSupplyPositions: (resources) => {
    const { map } = resources.get();
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
  getLoadedSupply: (units) => {
    return units.getAlive(Alliance.SELF).reduce((accumulator, currentValue) => accumulator + currentValue.cargoSpaceTaken, 0);
  },
}

module.exports = helper;