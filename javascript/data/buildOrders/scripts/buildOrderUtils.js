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
const BUILD_ORDER_ROOT = path.join(__dirname, '..');
const RACE_DIRECTORIES = ['protoss', 'terran', 'zerg'];
const ACTION_TO_UNIT_KEY = Object.freeze({
  'Lurker': 'LURKERMP',
  'Lurker Den': 'LURKERDENMP',
  'Swarm Host': 'SWARMHOSTMP',
  'Templar Archives': 'TEMPLARARCHIVE',
});

/** @type {Record<string, string>} */
let actionToUpgradeKey = {};

async function loadActionMappings() {
  try {
    const filePath = path.join(__dirname, "../../../data/gameData/actionMappings.json");
    actionToUpgradeKey = JSON.parse(await fs.readFile(filePath, "utf8"));
    console.log("Action mappings loaded successfully.");
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error loading action mappings, falling back to defaults:", error.message);
    } else {
      console.error("Unknown error occurred while loading action mappings.");
    }
    actionToUpgradeKey = {};
  }
}

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
 * Reads the canonical scraped build-order data and generates runtime files.
 * @param {string} dataFilePath - Path to the JSON file containing the scraped build order data.
 * @param {string} [outputRoot=BUILD_ORDER_ROOT] - Directory that owns the race subdirectories.
 * @returns {Promise<Record<string, number>>} Generated file counts by race.
 */
async function generateBuildOrderFiles(dataFilePath, outputRoot = BUILD_ORDER_ROOT) {
  await loadActionMappings();

  /** @type {import("src/core/globalTypes").BuildOrder[]} */
  const buildOrders = JSON.parse(await fs.readFile(dataFilePath, 'utf8'));
  const resolvedOutputRoot = path.resolve(outputRoot);
  const generatedFilesByRace = Object.fromEntries(
    RACE_DIRECTORIES.map(directory => [directory, new Map()])
  );

  for (const buildOrder of buildOrders) {
    if (!buildOrder || typeof buildOrder.title !== 'string' || !Array.isArray(buildOrder.steps)) {
      throw new Error('Build orders must include a title and steps array.');
    }

    const directory = determineRaceDirectory(buildOrder.raceMatchup);
    if (!directory) {
      throw new Error(`Unsupported race matchup for build order: ${buildOrder.title}`);
    }

    const fileName = sanitizeFileName(buildOrder.title) + '.js';
    const generatedFiles = generatedFilesByRace[directory];
    if (generatedFiles.has(fileName)) {
      throw new Error(`Build-order filename collision: ${directory}/${fileName}`);
    }

    generatedFiles.set(fileName, generateFileContent(buildOrder));
  }

  for (const directory of RACE_DIRECTORIES) {
    const directoryPath = path.resolve(resolvedOutputRoot, directory);
    if (!directoryPath.startsWith(resolvedOutputRoot + path.sep)) {
      throw new Error(`Generated build-order path escapes output root: ${directoryPath}`);
    }

    await fs.mkdir(directoryPath, { recursive: true });
    const generatedFiles = generatedFilesByRace[directory];

    for (const [fileName, fileContent] of generatedFiles) {
      await fs.writeFile(path.join(directoryPath, fileName), fileContent, 'utf8');
    }

    const existingFiles = await fs.readdir(directoryPath, { withFileTypes: true });
    for (const existingFile of existingFiles) {
      if (existingFile.isFile() && existingFile.name.endsWith('.js') && !generatedFiles.has(existingFile.name)) {
        await fs.unlink(path.join(directoryPath, existingFile.name));
      }
    }
  }

  return Object.fromEntries(
    RACE_DIRECTORIES.map(directory => [directory, generatedFilesByRace[directory].size])
  );
}

/**
 * Generates the content for a build order file.
 * @param {import("src/core/globalTypes").BuildOrder} buildOrder - The build order object.
 * @returns {string} The string to be written to the file.
 */
function generateFileContent(buildOrder) {
  const steps = buildOrder.steps.map((step, index) => {
    if (!step || typeof step.action !== 'string' || !step.action.trim()) {
      throw new Error(`Build order "${buildOrder.title}" has no action at step ${index}.`);
    }

    const actionParts = step.action.split(',').map(action => action.trim()).filter(Boolean);
    const hasCanonicalInterpretation = Object.prototype.hasOwnProperty.call(step, 'interpretedAction');
    if (hasCanonicalInterpretation && !Array.isArray(step.interpretedAction)) {
      throw new Error(`Build order "${buildOrder.title}" has an invalid canonical interpretation at step ${index}: ${step.action}`);
    }
    const interpretedAction = hasCanonicalInterpretation
      ? step.interpretedAction
      : interpretBuildOrderAction(step.action, step.comment);
    const unresolvedActions = interpretedAction.filter(action =>
      action.unitType === null && action.upgradeType === null && action.specialAction === null
    );
    if (interpretedAction.length !== actionParts.length) {
      throw new Error(`Build order "${buildOrder.title}" has an invalid canonical interpretation at step ${index}: ${step.action}`);
    }
    if (!hasCanonicalInterpretation && unresolvedActions.length > 0) {
      throw new Error(`Build order "${buildOrder.title}" has an unresolved action at step ${index}: ${step.action}`);
    }

    return {
      ...step,
      interpretedAction,
    };
  });
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
    const upgradeKey = actionToUpgradeKey[cleanedAction] || null;
    if (upgradeKey && Upgrade[upgradeKey]) {
      upgradeType = Upgrade[upgradeKey];
    } else {
      const unitKey = ACTION_TO_UNIT_KEY[cleanedAction] || formattedAction;
      if (UnitType[unitKey]) {
        unitType = UnitType[unitKey];
      }
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
 * @param {string} [buildOrderRoot] Optional runtime asset root; caches are isolated by resolved directory.
 * @returns {Promise<import('src/core/globalTypes').RaceBuildOrders>} Build orders loaded from the directory.
 */
async function loadBuildOrdersFromDirectory(directoryName, buildOrderRoot = BUILD_ORDER_ROOT) {
  const now = Date.now();
  const directoryPath = path.resolve(buildOrderRoot, directoryName);
  const cacheKey = directoryPath;

  if (buildOrderCache[cacheKey] && (now - buildOrderCache[cacheKey].timestamp < CACHE_EXPIRATION_MS)) {
    return buildOrderCache[cacheKey].data;
  }

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

  buildOrderCache[cacheKey] = { data: buildOrders, timestamp: now };

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
  loadActionMappings,
  interpretBuildOrderAction,
  isStepInProgress,
  generateBuildOrderFiles,
  loadBuildOrdersFromDirectory,
  buildOrderCache,
  determineRaceDirectory,
  sanitizeFileName,
};
