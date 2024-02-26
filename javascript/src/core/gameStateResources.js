// ts-check
'use strict';

// src/gameStateResources.js

/** 
 * This module manages shared game state resources.
 */

/** @type {Map<number, Point2D>} */
const buildingPositions = new Map();

/** @type {{foodUsed: number}} */
const foodData = {
  foodUsed: 12,
};

/**
 * Function or methods to manipulate buildingPositions and other shared resources
 * can be added here. For example:
 */

/**
 * Sets a new building position.
 * @param {number} key Key to identify the building position.
 * @param {Point2D} position Array of positions for the building.
 */
function setBuildingPosition(key, position) {
  buildingPositions.set(key, position);
}

/**
 * Retrieves building positions based on the key.
 * @param {number} key Key to identify the building position.
 * @returns {Point2D | undefined} Array of positions for the building or undefined.
 */
function getBuildingPosition(key) {
  return buildingPositions.get(key);
}

// Export the shared resources and utility functions
module.exports = {
  buildingPositions,
  foodData,
  setBuildingPosition,
  getBuildingPosition,
};