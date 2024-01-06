"use strict";


// Import necessary modules or dependencies
const { UnitType, Upgrade } = require("@node-sc2/core/constants");
const fs = require("fs");
const path = require("path");

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
 * Reads the scraped build order data and generates individual files,
 * overwriting existing files with updated content.
 * @param {string} dataFilePath - Path to the JSON file containing the scraped build order data.
 */
function generateBuildOrderFiles(dataFilePath) {
  // Parse the build orders from the file
  /** @type {import("../utils/globalTypes").BuildOrder[]} */
  const buildOrders = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));

  buildOrders.forEach(buildOrder => {
    // Determine the directory based on the race matchup
    const directory = determineRaceDirectory(buildOrder.raceMatchup);

    if (directory) {
      // Construct the file path
      const filePath = path.join(__dirname, directory, sanitizeFileName(buildOrder.title) + '.js');

      // Generate the content for the file, ensuring the updated interpretBuildOrderAction is used
      const fileContent = generateFileContent(buildOrder);

      // Write (or overwrite) the file with the new content
      fs.writeFileSync(filePath, fileContent);
    }
  });
}

/**
 * Generates the content for a build order file.
 * @param {import("../utils/globalTypes").BuildOrder} buildOrder - The build order object.
 * @returns {string} The string to be written to the file.
 */
function generateFileContent(buildOrder) {
  const steps = buildOrder.steps.map(step => ({
    ...step,
    interpretedAction: interpretBuildOrderAction(step.action, step.comment)
  }));
  return `module.exports = ${JSON.stringify({ ...buildOrder, steps }, null, 2)};\n`;
}

/**
 * Dynamically interprets build order actions, converting action strings to either UnitType or Upgrade references.
 * @param {string} action - The action string from the build order.
 * @param {string} [comment] - Optional comment associated with the action.
 * @returns {import("../utils/globalTypes").InterpretedAction} An object representing the interpreted action.
 */
function interpretBuildOrderAction(action, comment = '') {
  /**
   * Maps action strings to corresponding upgrade keys.
   * @param {string} action - The action string.
   * @returns {string | null} - The upgrade key or null if not found.
   */
  function getUpgradeKey(action) {
    /** @type {Object<string, string>} */
    const actionToUpgradeKey = {
      'Blink': 'BLINKTECH',
      // Add other mappings as needed
    };

    return actionToUpgradeKey[action] || null;
  }

  // Remove additional details like "(Chrono Boost)" or "x3"
  const cleanedAction = action.replace(/\s+\(.*?\)|\sx\d+/g, '');

  // Replace spaces with underscores and convert to uppercase
  const formattedAction = cleanedAction.toUpperCase().replace(/\s+/g, '');

  let unitType = null;
  let upgradeType = null;
  let specialAction = null;

  // Check if the action is an upgrade
  const upgradeKey = getUpgradeKey(cleanedAction);
  if (upgradeKey && upgradeKey in Upgrade) {
    // Bypass TypeScript strict type checking for Upgrade indexing
    /** @type {{[key: string]: number}} */
    const typedUpgrade = Upgrade;
    upgradeType = typedUpgrade[upgradeKey];
  } else if (formattedAction in UnitType) {
    /** @type {{[key: string]: number}} */
    const typedUnitType = UnitType;
    unitType = typedUnitType[formattedAction];
  }

  // Check if the action should be interpreted based on the comment
  if (unitType === null && upgradeType === null) {
    if (comment.includes("SCOUT CSV")) {
      specialAction = 'Scouting with SCV';
      unitType = UnitType['SCV']; // Replace with the correct enum for SCV
    }
    // Add additional else-if blocks for other special comments/actions
  }

  const countMatch = action.match(/\sx(\d+)/);
  const count = countMatch ? parseInt(countMatch[1], 10) : 1;

  const isUpgrade = !!upgradeKey;
  const isChronoBoosted = action.includes("Chrono Boost");

  return { unitType, upgradeType, count, isUpgrade, isChronoBoosted, specialAction };
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