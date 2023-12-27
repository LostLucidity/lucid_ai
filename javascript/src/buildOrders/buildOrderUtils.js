"use strict";


// Import necessary modules or dependencies
const { UnitType } = require("@node-sc2/core/constants");
const fs = require("fs");
const path = require("path");

/** 
 * @typedef {Object} BuildOrder
 * @property {string} title - The title of the build order.
 * @property {string} raceMatchup - The race matchup indicator (e.g., PvZ, TvT, ZvX).
 * @property {BuildOrderStep[]} steps - The steps in the build order.
 * @property {string} url - The URL of the detailed build order page.
 */

/** 
 * @typedef {Object} BuildOrderStep
 * @property {string} supply - The supply count at this step.
 * @property {string} time - The game time for this step.
 * @property {string} action - The action to be taken at this step.
 */

/**
 * Determines the directory name based on the race matchup of the build order.
 * @param {string} raceMatchup - The race matchup indicator (e.g., PvZ, TvT, ZvX).
 * @returns {string|null} The directory name, or null if it cannot be determined.
 */
function determineRaceDirectory(raceMatchup) {
  if (raceMatchup.startsWith('Pv')) {
    return 'protoss';
  } else if (raceMatchup.startsWith('Tv')) {
    return 'terran';
  } else if (raceMatchup.startsWith('Zv')) {
    return 'zerg';
  }
  return null;
}

/**
 * Reads the scraped build order data and generates individual files.
 * @param {string} dataFilePath - Path to the JSON file containing the scraped build order data.
 */
function generateBuildOrderFiles(dataFilePath) {
  /** @type {BuildOrder[]} */
  const buildOrders = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));

  buildOrders.forEach(buildOrder => {
    const directory = determineRaceDirectory(buildOrder.raceMatchup);
    if (directory) {
      const filePath = path.join(__dirname, directory, sanitizeFileName(buildOrder.title) + '.js');
      const fileContent = generateFileContent(buildOrder);
      fs.writeFileSync(filePath, fileContent);
    }
  });
}

/**
 * Generates the content for a build order file.
 * @param {BuildOrder} buildOrder - The build order object.
 * @returns {string} The string to be written to the file.
 */
function generateFileContent(buildOrder) {
  const steps = buildOrder.steps.map(step => ({
    ...step,
    interpretedAction: interpretBuildOrderAction(step.action)
  }));
  return `module.exports = ${JSON.stringify({ ...buildOrder, steps }, null, 2)};\n`;
}

/**
 * Dynamically interprets build order actions, directly converting action strings to UnitType references.
 * @param {string} action - The action string from the build order.
 * @returns {{unitType: number, count: number, isUpgrade: boolean, isChronoBoosted: boolean}}
 */
function interpretBuildOrderAction(action) {
  const formattedAction = action.split(' ')[0].toUpperCase().replace(/\s+/g, '_');

  let unitType;

  if (formattedAction in UnitType) {
    // Type assertion to bypass TypeScript error
    unitType = UnitType[/** @type {keyof typeof UnitType} */ (formattedAction)];
  } else {
    unitType = UnitType.INVALID;
  }

  const countMatch = action.match(/\sx(\d+)/);
  const count = countMatch ? parseInt(countMatch[1], 10) : 1;

  const isUpgrade = action.includes("Level") || action.includes("Thermal Lance") || action.includes("Charge");
  const isChronoBoosted = action.includes("Chrono Boost");

  return { unitType, count, isUpgrade, isChronoBoosted };
}

/**
 * Loads build orders from a specified directory.
 * @param {string} directoryName - Name of the directory (e.g., 'protoss', 'terran', 'zerg').
 * @returns {import('../utils/globalTypes').RaceBuildOrders} Build orders loaded from the directory.
 */
function loadBuildOrdersFromDirectory(directoryName) {
  const directoryPath = path.join(__dirname, directoryName);
  const buildOrderFiles = fs.readdirSync(directoryPath);

  /** @type {import('../utils/globalTypes').RaceBuildOrders} */
  const buildOrders = {};

  buildOrderFiles.forEach(file => {
    if (file.endsWith('.js')) {
      const buildOrder = require(path.join(directoryPath, file));
      buildOrders[file.replace('.js', '')] = buildOrder;
    }
  });

  return buildOrders;
}

/**
 * Sanitizes a string to make it a valid file name.
 * @param {string} title - The string to sanitize.
 * @returns {string} The sanitized string.
 */
function sanitizeFileName(title) {
  return title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Export the utility functions
module.exports = {
  interpretBuildOrderAction,
  generateBuildOrderFiles,
  loadBuildOrdersFromDirectory
};
