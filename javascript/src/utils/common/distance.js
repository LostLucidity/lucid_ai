//@ts-check
"use strict"

const { getGasGeysers } = require("./mapUtils");
const { getClosestUnitByPath } = require("./pathfinding");
const { getPathablePositionsForStructure, getDistanceByPath } = require("./utils");

/**
 *
 * @param {ResourceManager} resources
 * @param {Unit} unit
 * @param {Unit[]} units
 * @returns {Unit | undefined}
 */
function getClosestUnitFromUnit(resources, unit, units) {
  const { map, units: unitResource } = resources.get();
  const { pos } = unit;
  if (pos === undefined) return undefined;
  const pathablePositions = getPathablePositionsForStructure(map, unit);
  const pathablePositionsForUnits = units.map(unit => getPathablePositionsForStructure(map, unit));
  const distances = pathablePositions.map(pathablePosition => {
    const distancesToUnits = pathablePositionsForUnits.map(pathablePositionsForUnit => {
      const distancesToUnit = pathablePositionsForUnit.map(pathablePositionForUnit => {
        return getDistanceByPath(resources, pathablePosition, pathablePositionForUnit);
      });
      return Math.min(...distancesToUnit);
    });
    return Math.min(...distancesToUnits);
  });
  const closestPathablePosition = pathablePositions[distances.indexOf(Math.min(...distances))];
  return getClosestUnitByPath(resources, closestPathablePosition, units, getGasGeysers(unitResource), 1)[0];
}

module.exports = {
  getClosestUnitFromUnit,
};