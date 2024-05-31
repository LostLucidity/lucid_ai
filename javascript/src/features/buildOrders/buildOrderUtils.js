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
  switch (raceMatchup[0]) {
    case 'P': return 'protoss';
    case 'T': return 'terran';
    case 'Z': return 'zerg';
    default: return null;
  }
}

/**
 * Reads the scraped build order data and generates individual files,
 * overwriting existing files with updated content.
 * @param {string} dataFilePath - Path to the JSON file containing the scraped build order data.
 */
function generateBuildOrderFiles(dataFilePath) {
  try {
    // Parse the build orders from the file
    /** @type {import("../../utils/globalTypes").BuildOrder[]} */
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
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error generating build order files: ${error.message}`);
    } else {
      console.error('Unknown error generating build order files');
    }
  }
}

/**
 * Generates the content for a build order file.
 * @param {import("../../utils/globalTypes").BuildOrder} buildOrder - The build order object.
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
 * @returns {Array<import("../../utils/globalTypes").InterpretedAction>} An array of objects representing the interpreted actions.
 */
function interpretBuildOrderAction(action, comment = '') {
  /**
   * Maps action strings to corresponding upgrade keys.
   * @param {string} action - The action string.
   * @returns {string | null} - The upgrade key or null if not found.
   */
  function getUpgradeKey(action) {
    /** @type {Record<string, string>} */
    const actionToUpgradeKey = {
      'Blink': 'BLINKTECH',
      // Add other mappings as needed
    };

    return actionToUpgradeKey[action] || null;
  }

  /**
   * @typedef {Object} ActionDetails
   * @property {string} cleanedAction - The cleaned action string.
   * @property {number} count - The count of actions.
   * @property {boolean} isChronoBoosted - Whether the action is chrono boosted.
   */

  /**
   * Extracts the core details from an action part string.
   * @param {string} actionPart - The action part string.
   * @returns {ActionDetails} - The extracted details including cleaned action, count, and chrono boost status.
   */
  const extractActionDetails = (actionPart) => {
    const match = actionPart.match(/^(.*?)(?:\sx(\d+))?(?:\s\(Chrono Boost\))?$/);
    if (!match) return { cleanedAction: '', count: 0, isChronoBoosted: false };

    const cleanedAction = match[1].trim();
    const count = match[2] ? parseInt(match[2], 10) : 1;
    const isChronoBoosted = actionPart.includes("(Chrono Boost)");

    return { cleanedAction, count, isChronoBoosted };
  };

  /**
   * Type guard to check if a key exists in an object.
   * @param {object} obj - The object to check.
   * @param {string} key - The key to check.
   * @returns {boolean} - Whether the key exists in the object.
   */
  const isKeyOf = (obj, key) => key in obj;

  const actions = action.split(',');
  /** @type {Array<import("../../utils/globalTypes").InterpretedAction>} */
  const interpretedActions = [];

  actions.forEach(actionPart => {
    const details = extractActionDetails(actionPart);
    if (!details.cleanedAction) return;

    const { cleanedAction, count, isChronoBoosted } = details;
    const formattedAction = cleanedAction.toUpperCase().replace(/\s+/g, '');

    let unitType = null;
    let upgradeType = null;
    let specialAction = null;

    const upgradeKey = getUpgradeKey(cleanedAction);
    if (upgradeKey && isKeyOf(Upgrade, upgradeKey)) {
      upgradeType = Upgrade[upgradeKey];
    } else if (isKeyOf(UnitType, formattedAction)) {
      unitType = UnitType[formattedAction];
    }

    if (!unitType && !upgradeType) {
      if (comment.includes("CALL DOWN MULES")) {
        specialAction = 'Call Down MULEs';
        unitType = UnitType['MULE'];
      } else if (comment.includes("SCOUT SCV") || comment.includes("SCOUT CSV")) {
        specialAction = 'Scouting with SCV';
        unitType = UnitType['SCV'];
      }
    }

    interpretedActions.push({ unitType, upgradeType, count, isUpgrade: !!upgradeKey, isChronoBoosted, specialAction });
  });

  return interpretedActions;
}

/**
 * Loads build orders from a specified directory.
 * @param {string} directoryName - Name of the directory (e.g., 'protoss', 'terran', 'zerg').
 * @returns {import('../../utils/globalTypes').RaceBuildOrders} Build orders loaded from the directory.
 */
function loadBuildOrdersFromDirectory(directoryName) {
  const directoryPath = path.join(__dirname, directoryName);
  const buildOrderFiles = fs.readdirSync(directoryPath);

  /** @type {import('../../utils/globalTypes').RaceBuildOrders} */
  const buildOrders = {};

  buildOrderFiles.forEach(file => {
    if (file.endsWith('.js')) {
      try {
        const buildOrder = require(path.join(directoryPath, file));
        buildOrders[file.replace('.js', '')] = buildOrder;
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error loading build order from file ${file}: ${error.message}`);
        } else {
          console.error(`Unknown error loading build order from file ${file}`);
        }
      }
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
