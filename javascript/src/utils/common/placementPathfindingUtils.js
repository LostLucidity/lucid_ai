//@ts-check
"use strict";

const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { createPoint2D } = require('@node-sc2/core/utils/geometry/point');
const { getFootprint } = require('@node-sc2/core/utils/geometry/units');

const { getDistance } = require('./geometryUtils');

/**
 * Shared utility functions for pathfinding and placement calculations.
 */

/**
 * Retrieves cell positions occupied by given structures.
 * @param {Point2D} position - The position to check around.
 * @param {Unit[]} structures - The structures to consider.
 * @returns {Point2D[]} - Array of cells occupied by the structures.
 */
function getStructureCells(position, structures) {
  return structures.reduce((/** @type {Point2D[]} */ acc, structure) => {
    const { pos, unitType } = structure;
    if (pos === undefined || unitType === undefined) return acc;
    if (getDistance(pos, position) <= 1) {
      const footprint = getFootprint(unitType);
      if (footprint === undefined) return acc;
      acc.push(...cellsInFootprint(createPoint2D(pos), footprint));
    }
    return acc;
  }, []);
}

module.exports = {
  getStructureCells,
};
