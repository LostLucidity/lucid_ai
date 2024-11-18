"use strict";

// Import necessary modules or dependencies
const { UnitType, Upgrade } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const fs = require("fs").promises;
const path = require("path");

const { GameState } = require("../../../src/state");
const { getBasicProductionUnits } = require("../../../src/units/management/basicUnitUtils");

/** 
 * @type {Record<string, { data: import('src/core/globalTypes').RaceBuildOrders, timestamp: number }>} 
 */
const buildOrderCache = {};

const CACHE_EXPIRATION_MS = 5 * 60 * 1000;

/**
 * Determines the directory name based on the race matchup of the build order.
 * @param {string} raceMatchup - The race matchup indicator (e.g., PvZ, TvT, ZvX).
 * @returns {string|null} The directory name, or null if it cannot be determined.
 */
function determineRaceDirectory(raceMatchup) {
  /** @type {{ [key: string]: string }} */
  const raceMap = { 'P': 'protoss', 'T': 'terran', 'Z': 'zerg' };
  const raceKey = raceMatchup[0];

  if (Object.prototype.hasOwnProperty.call(raceMap, raceKey)) {
    return raceMap[raceKey];
  } else {
    return null;
  }
}

/**
 * Reads the scraped build order data and generates individual files,
 * overwriting existing files with updated content.
 * @param {string} dataFilePath - Path to the JSON file containing the scraped build order data.
 */
async function generateBuildOrderFiles(dataFilePath) {
  try {
    // Parse the build orders from the file
    /** @type {import("src/core/globalTypes").BuildOrder[]} */
    const buildOrders = JSON.parse(await fs.readFile(dataFilePath, 'utf8'));

    for (const buildOrder of buildOrders) {
      // Determine the directory based on the race matchup
      const directory = determineRaceDirectory(buildOrder.raceMatchup);

      if (directory) {
        // Construct the file path
        const filePath = path.join(__dirname, directory, sanitizeFileName(buildOrder.title) + '.js');

        // Generate the content for the file, ensuring the updated interpretBuildOrderAction is used
        const fileContent = generateFileContent(buildOrder);

        // Write (or overwrite) the file with the new content
        await fs.writeFile(filePath, fileContent);
      }
    }
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
 * @param {import("src/core/globalTypes").BuildOrder} buildOrder - The build order object.
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
 * Identifies special actions based on comments and sets the corresponding action.
 * @param {string} comment - The comment string associated with the action.
 * @returns {{ specialAction: string | null, unitType: any | null }}
 */
function getSpecialAction(comment) {
  if (comment.includes("CALL DOWN MULES")) {
    return { specialAction: 'Call Down MULEs', unitType: UnitType['MULE'] };
  }
  if (comment.includes("SCOUT SCV") || comment.includes("SCOUT CSV")) {
    return { specialAction: 'Scouting with SCV', unitType: UnitType['SCV'] };
  }
  return { specialAction: null, unitType: null };
}

/**
 * Dynamically interprets build order actions, converting action strings to either UnitType or Upgrade references.
 * @param {string} action - The action string from the build order.
 * @param {string} [comment] - Optional comment associated with the action.
 * @returns {Array<import("src/core/globalTypes").InterpretedAction>} An array of objects representing the interpreted actions.
 */
function interpretBuildOrderAction(action, comment = '') {
  if (!action || typeof action !== 'string') {
    console.error('Invalid action input:', action);
    return [];
  }

  const actions = action.split(',');

  /** @type {Array<import("src/core/globalTypes").InterpretedAction>} */
  const interpretedActions = actions.reduce(
    (result, actionPart) => {
      const interpretedAction = processAction(actionPart, comment);

      if (interpretedAction) {
        result.push(interpretedAction);
      } else {
        console.warn(`Unrecognized action: ${actionPart.trim()}`);
        result.push({
          unitType: null,
          upgradeType: null,
          count: 1,
          isUpgrade: false,
          isChronoBoosted: false,
          specialAction: null,
        });
      }

      return result;
    },
    /** @type {Array<import("src/core/globalTypes").InterpretedAction>} */([]), // Explicitly type the initial value
  );

  return interpretedActions;
}

/**
 * Processes a single action part.
 * @param {string} actionPart - The action string part to process.
 * @param {string} [comment] - An optional comment.
 * @returns {import("src/core/globalTypes").InterpretedAction | null}
 */
function processAction(actionPart, comment = '') {
  const { cleanedAction, count, isChronoBoosted } = extractActionDetails(actionPart);
  if (!cleanedAction) return null;

  const formattedAction = cleanedAction.toUpperCase().replace(/\s+/g, '');

  let unitType = null;
  let upgradeType = null;

  if (formattedAction === 'VIKING') {
    unitType = UnitType.VIKINGFIGHTER;
  } else if (Upgrade[formattedAction]) {
    upgradeType = Upgrade[formattedAction];
  } else {
    const upgradeKey = getUpgradeKey(cleanedAction);
    if (upgradeKey && Upgrade[upgradeKey]) {
      upgradeType = Upgrade[upgradeKey];
    } else if (UnitType[formattedAction]) {
      unitType = UnitType[formattedAction];
    }
  }

  const { specialAction, unitType: specialUnitType } = getSpecialAction(comment);
  if (specialAction) unitType = specialUnitType;

  if (!unitType && !upgradeType) {
    console.warn(`Unrecognized action: ${cleanedAction}`);
    return null;
  }

  return {
    unitType,
    upgradeType,
    count,
    isUpgrade: !!upgradeType,
    isChronoBoosted,
    specialAction,
  };
}

/**
 * Extracts details from an action string.
 * @param {string} actionPart - The action string part.
 * @returns {{ cleanedAction: string, count: number, isChronoBoosted: boolean }}
 */
function extractActionDetails(actionPart) {
  const actionDetailRegex = /^(.*?)(?:\sx(\d+))?(?:\s\((Chrono Boost)\))?$/;
  const match = actionDetailRegex.exec(actionPart);

  if (!match) return { cleanedAction: '', count: 0, isChronoBoosted: false };

  const cleanedAction = match[1].trim();
  const count = match[2] ? parseInt(match[2], 10) : 1;
  const isChronoBoosted = Boolean(match[3]);

  return { cleanedAction, count, isChronoBoosted };
}

/**
 * Maps specific action strings to upgrade keys.
 * @param {string} action - The action string.
 * @returns {string | null} - The upgrade key or null if not found.
 */
function getUpgradeKey(action) {
  /** @type {Record<string, string>} */
  const actionToUpgradeKey = {
    'Warp Gate': 'WARPGATERESEARCH',
    'Blink': 'BLINKTECH',
  };
  return actionToUpgradeKey[action] || null;
}

/**
 * Check if a step (construction, morph, training, or upgrade) is in progress.
 * @param {World} world - The current game world state.
 * @param {import("src/core/globalTypes").BuildOrderStep} step - The build order step to check.
 * @returns {boolean} - True if the step is in progress, otherwise false.
 */
function isStepInProgress(world, step) {
  const { resources, data } = world;
  const { units } = resources.get();

  const interpretedActions = Array.isArray(step.interpretedAction)
    ? step.interpretedAction
    : step.interpretedAction
      ? [step.interpretedAction]
      : interpretBuildOrderAction(step.action, "comment" in step ? step.comment : "");

  return interpretedActions.some(action => {
    if (action.isUpgrade) {
      return action.upgradeType !== null && GameState.getInstance().isUpgradeInProgress(action.upgradeType);
    }

    const unitTypes = action.unitType ? [action.unitType] : [];
    if (unitTypes.length === 0) return false;

    return unitTypes.some(unitType => isUnitTypeInProgress(world, units, unitType, data));
  });
}

/**
 * Check if a unit is in progress (construction, morph, or training).
 * @param {World} world - The current game world state.
 * @param {Unit} unit - The unit to check.
 * @param {number} unitType - The unit type to check.
 * @param {number} abilityId - The ability ID associated with the unit type.
 * @returns {boolean} - True if the unit is in progress, otherwise false.
 */
function isUnitInProgress(world, unit, unitType, abilityId) {
  if (unit.unitType === unitType && unit.buildProgress !== undefined && unit.buildProgress > 0 && unit.buildProgress < 1) {
    return true;
  }

  if (unit.orders && unit.orders.some(order => order.abilityId === abilityId)) {
    const productionUnits = getBasicProductionUnits(world, unitType)
      .filter(productionUnit => productionUnit.unitType && !workerTypes.includes(productionUnit.unitType));

    return productionUnits.some(productionUnit =>
      productionUnit.orders && productionUnit.orders.some(productionOrder => productionOrder.abilityId === abilityId)
    );
  }

  return false;
}

/**
 * Check if a unit type is in progress.
 * @param {World} world - The current game world state.
 * @param {UnitResource} units - The unit resources.
 * @param {number} unitType - The unit type to check.
 * @param {DataStorage} data - The game data.
 * @returns {boolean} - True if the unit type is in progress, otherwise false.
 */
function isUnitTypeInProgress(world, units, unitType, data) {
  const unitData = data.getUnitTypeData(unitType);
  const abilityId = unitData?.abilityId;
  if (abilityId === null || abilityId === undefined) return false;

  return units.getAll(Alliance.SELF).some(unit => isUnitInProgress(world, unit, unitType, abilityId));
}

/**
 * Loads build orders from a specified directory with cache invalidation.
 * @param {string} directoryName - Name of the directory (e.g., 'protoss', 'terran', 'zerg').
 * @returns {Promise<import('src/core/globalTypes').RaceBuildOrders>} Build orders loaded from the directory.
 */
async function loadBuildOrdersFromDirectory(directoryName) {
  const now = Date.now();

  if (buildOrderCache[directoryName] && (now - buildOrderCache[directoryName].timestamp < CACHE_EXPIRATION_MS)) {
    return buildOrderCache[directoryName].data;
  }

  const directoryPath = path.join(__dirname, '..', directoryName);
  const buildOrderFiles = await fs.readdir(directoryPath, { withFileTypes: true });

  /** @type {import('src/core/globalTypes').RaceBuildOrders} */
  const buildOrders = {};

  for (const file of buildOrderFiles) {
    if (file.isFile() && file.name.endsWith('.js')) {
      try {
        const buildOrder = require(path.join(directoryPath, file.name));
        buildOrders[file.name.replace('.js', '')] = buildOrder;
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error loading build order from file ${file.name}: ${error.message}`);
        } else {
          console.error(`Unknown error loading build order from file ${file.name}`);
        }
      }
    }
  }

  buildOrderCache[directoryName] = { data: buildOrders, timestamp: now };

  return buildOrders;
}

/**
 * Sanitizes a string to make it a valid file name.
 * @param {string} title - The string to sanitize.
 * @returns {string} The sanitized string.
 */
function sanitizeFileName(title) {
  return title.replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/_+/g, '_').slice(0, 255);
}

// Export the utility functions
module.exports = {
  interpretBuildOrderAction,
  isStepInProgress,
  generateBuildOrderFiles,
  loadBuildOrdersFromDirectory,
  buildOrderCache
};
