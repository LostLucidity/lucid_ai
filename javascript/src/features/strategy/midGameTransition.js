const { townhallTypes } = require('@node-sc2/core/constants/groups');
const UnitTypeId = require('@node-sc2/core/constants/unit-type');
const fs = require('fs');
const path = require('path');

const buildOrderState = require('../../globalState/buildOrderState');
const { train } = require('../../units/management/training');
const { createMoveCommand } = require('../../units/management/unitCommands');
const { upgrade } = require('../../units/management/unitManagement');
const { build } = require('../construction/buildingService');
const { isSuitableForScouting } = require('../shared/scoutingUtils');
const { handleActiveScout, setActiveScoutTag } = require('../shared/scoutManager');
const configPath = path.join(__dirname, '../../config/config.json');
const rawData = fs.readFileSync(configPath);
const config = JSON.parse(rawData.toString());

// Define a list of tech building unit types
const techBuildingTypes = [
  UnitTypeId.ENGINEERINGBAY,
  UnitTypeId.ARMORY,
  UnitTypeId.FUSIONCORE,
  UnitTypeId.CYBERNETICSCORE,
  UnitTypeId.FLEETBEACON,
  UnitTypeId.ROBOTICSBAY,
  UnitTypeId.TEMPLARARCHIVE,
  UnitTypeId.DARKSHRINE,
  UnitTypeId.EVOLUTIONCHAMBER,
  UnitTypeId.SPAWNINGPOOL,
  UnitTypeId.ROACHWARREN,
  UnitTypeId.BANELINGNEST,
  UnitTypeId.HYDRALISKDEN,
  UnitTypeId.SPIRE,
  UnitTypeId.ULTRALISKCAVERN,
  UnitTypeId.INFESTATIONPIT
];

// Define a list of production structure unit types
const productionStructureTypes = [
  UnitTypeId.BARRACKS,
  UnitTypeId.FACTORY,
  UnitTypeId.STARPORT,
  UnitTypeId.GATEWAY,
  UnitTypeId.WARPGATE,
  UnitTypeId.ROBOTICSFACILITY,
  UnitTypeId.STARGATE,
  UnitTypeId.HATCHERY,
  UnitTypeId.LAIR,
  UnitTypeId.HIVE,
  UnitTypeId.SPAWNINGPOOL,
  UnitTypeId.ROACHWARREN,
  UnitTypeId.HYDRALISKDEN,
  UnitTypeId.SPIRE,
  UnitTypeId.ULTRALISKCAVERN
];

// Mapping of production structures to the units they can produce
const productionUnits = {
  [UnitTypeId.BARRACKS]: [UnitTypeId.MARINE, UnitTypeId.REAPER, UnitTypeId.MARAUDER, UnitTypeId.GHOST],
  [UnitTypeId.FACTORY]: [UnitTypeId.HELLION, UnitTypeId.SIEGETANK, UnitTypeId.THOR, UnitTypeId.CYCLONE, UnitTypeId.WIDOWMINE],
  [UnitTypeId.STARPORT]: [UnitTypeId.MEDIVAC, UnitTypeId.VIKINGFIGHTER, UnitTypeId.RAVEN, UnitTypeId.BANSHEE, UnitTypeId.BATTLECRUISER],
  [UnitTypeId.GATEWAY]: [UnitTypeId.ZEALOT, UnitTypeId.STALKER, UnitTypeId.SENTRY, UnitTypeId.ADEPT, UnitTypeId.HIGHTEMPLAR, UnitTypeId.DARKTEMPLAR],
  [UnitTypeId.WARPGATE]: [UnitTypeId.ZEALOT, UnitTypeId.STALKER, UnitTypeId.SENTRY, UnitTypeId.ADEPT, UnitTypeId.HIGHTEMPLAR, UnitTypeId.DARKTEMPLAR],
  [UnitTypeId.ROBOTICSFACILITY]: [UnitTypeId.OBSERVER, UnitTypeId.IMMORTAL, UnitTypeId.WARPPRISM, UnitTypeId.COLOSSUS, UnitTypeId.DISRUPTOR],
  [UnitTypeId.STARGATE]: [UnitTypeId.PHOENIX, UnitTypeId.VOIDRAY, UnitTypeId.ORACLE, UnitTypeId.CARRIER, UnitTypeId.TEMPEST],
  [UnitTypeId.HATCHERY]: [UnitTypeId.QUEEN, UnitTypeId.ZERGLING, UnitTypeId.ROACH, UnitTypeId.HYDRALISK, UnitTypeId.MUTALISK, UnitTypeId.CORRUPTOR, UnitTypeId.INFESTOR, UnitTypeId.ULTRALISK],
  [UnitTypeId.LAIR]: [UnitTypeId.QUEEN, UnitTypeId.ZERGLING, UnitTypeId.ROACH, UnitTypeId.HYDRALISK, UnitTypeId.MUTALISK, UnitTypeId.CORRUPTOR, UnitTypeId.INFESTOR, UnitTypeId.ULTRALISK],
  [UnitTypeId.HIVE]: [UnitTypeId.QUEEN, UnitTypeId.ZERGLING, UnitTypeId.ROACH, UnitTypeId.HYDRALISK, UnitTypeId.MUTALISK, UnitTypeId.CORRUPTOR, UnitTypeId.INFESTOR, UnitTypeId.ULTRALISK],
  [UnitTypeId.SPAWNINGPOOL]: [UnitTypeId.ZERGLING],
  [UnitTypeId.ROACHWARREN]: [UnitTypeId.ROACH],
  [UnitTypeId.HYDRALISKDEN]: [UnitTypeId.HYDRALISK],
  [UnitTypeId.SPIRE]: [UnitTypeId.MUTALISK, UnitTypeId.CORRUPTOR],
  [UnitTypeId.ULTRALISKCAVERN]: [UnitTypeId.ULTRALISK]
};

// Manually define a mapping of unit types to their upgrade abilities
const upgradeAbilities = {
  [UnitTypeId.ENGINEERINGBAY]: [/* upgrade ability IDs for Engineering Bay */],
  [UnitTypeId.ARMORY]: [/* upgrade ability IDs for Armory */],
  [UnitTypeId.FUSIONCORE]: [/* upgrade ability IDs for Fusion Core */],
  [UnitTypeId.CYBERNETICSCORE]: [/* upgrade ability IDs for Cybernetics Core */],
  [UnitTypeId.FLEETBEACON]: [/* upgrade ability IDs for Fleet Beacon */],
  [UnitTypeId.ROBOTICSBAY]: [/* upgrade ability IDs for Robotics Bay */],
  [UnitTypeId.TEMPLARARCHIVE]: [/* upgrade ability IDs for Templar Archive */],
  [UnitTypeId.DARKSHRINE]: [/* upgrade ability IDs for Dark Shrine */],
  [UnitTypeId.EVOLUTIONCHAMBER]: [/* upgrade ability IDs for Evolution Chamber */],
  [UnitTypeId.SPAWNINGPOOL]: [/* upgrade ability IDs for Spawning Pool */],
  [UnitTypeId.ROACHWARREN]: [/* upgrade ability IDs for Roach Warren */],
  [UnitTypeId.BANELINGNEST]: [/* upgrade ability IDs for Baneling Nest */],
  [UnitTypeId.HYDRALISKDEN]: [/* upgrade ability IDs for Hydralisk Den */],
  [UnitTypeId.SPIRE]: [/* upgrade ability IDs for Spire */],
  [UnitTypeId.ULTRALISKCAVERN]: [/* upgrade ability IDs for Ultralisk Cavern */],
  [UnitTypeId.INFESTATIONPIT]: [/* upgrade ability IDs for Infestation Pit */]
};

// Define a list of known scout unit types
const scoutUnitTypes = [
  UnitTypeId.REAPER,
  UnitTypeId.OBSERVER,
  UnitTypeId.OVERLORD,
  UnitTypeId.OVERSEER,
  UnitTypeId.ZERGLING, // Often used as scouts in Zerg gameplay
  UnitTypeId.PROBE,
  UnitTypeId.SCV
];

/**
 * Produces units from the bot's production structures.
 * @param {World} world - The world instance controlling the game actions.
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList - The list of actions to be executed.
 */
const buildArmy = async (world, actionList) => {
  const { units, frame } = world.resources.get();
  const productionStructures = units.getAlive().filter(unit => unit.unitType !== undefined && productionStructureTypes.includes(unit.unitType) && unit.isFinished());
  const observation = frame.getObservation();
  const resources = observation?.playerCommon ?? { minerals: 0, vespene: 0 };  // Accessing resources through the observation data

  productionStructures.forEach(structure => {
    const structureType = structure.unitType;
    if (structureType !== undefined) {
      const availableUnits = productionUnits[structureType] || [];
      availableUnits.forEach(unitType => {
        const unitData = world.data.getUnitTypeData(unitType);
        if (
          unitData &&
          unitData.mineralCost !== undefined &&
          unitData.vespeneCost !== undefined &&
          (resources.minerals ?? 0) >= unitData.mineralCost &&
          (resources.vespene ?? 0) >= unitData.vespeneCost
        ) {
          const trainingActions = train(world, unitType);  // Call train with unitType only
          actionList.push(...trainingActions); // Use spread operator to add multiple actions
        }
      });
    }
  });
};

/**
 * Helper function to find an expansion location
 * @param {World} world - The world instance controlling the game actions.
 * @returns {Promise<Point2D | null>} - The location to expand, or null if no location is found.
 */
const findExpansionLocation = async (world) => {
  const { map, units } = world.resources.get();
  const expansions = map.getExpansions();
  const townHalls = units.getAlive().filter(unit => unit.isTownhall());

  // Filter expansions that don't have a town hall built on them
  const availableExpansions = expansions.filter(expansion => {
    return !townHalls.some(townHall =>
      townHall.pos?.x === expansion.townhallPosition.x &&
      townHall.pos?.y === expansion.townhallPosition.y
    );
  });

  return availableExpansions.length > 0 ? availableExpansions[0].townhallPosition : null;
};

/**
 * Helper function to check if a unit is a tech building
 * @param {Unit} unit - The unit to check.
 * @returns {boolean} - True if the unit is a tech building, false otherwise.
 */
const isTechBuilding = (unit) => {
  return unit.unitType !== undefined && techBuildingTypes.includes(unit.unitType);
};

/**
 * Manages the mid-game transition logic.
 * @param {World} world - The current game world state.
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList - The list of actions to be executed.
 */
const midGameTransition = async (world, actionList) => {
  const { units, frame } = world.resources.get();
  const resources = frame.getObservation()?.playerCommon ?? {};

  const townHalls = units.getAlive().filter(unit => unit.unitType !== undefined && townhallTypes.includes(unit.unitType) && unit.isFinished());

  if (townHalls.length < config.maxTownHalls && (resources.minerals ?? 0) >= config.townHallCost) {
    const location = await findExpansionLocation(world);
    if (location) {
      const buildActions = build(world, townhallTypes[0], 1, [location]);
      actionList.push(...buildActions);  // Use spread operator to add the actions to actionList
    }
  }

  await researchUpgrades(world, actionList);

  // Only build an army and scout if the build order is completed
  if (buildOrderState.isBuildOrderCompleted()) {
    await buildArmy(world, actionList);
    await scout(world, actionList);
  }
};

/**
 * Researches upgrades at the bot's tech buildings.
 * @param {World} world - The world instance controlling the game actions.
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList - The list of actions to be executed.
 */
const researchUpgrades = async (world, actionList) => {
  const { units, frame } = world.resources.get();
  const observation = frame.getObservation();
  const currentUpgrades = observation?.rawData?.player?.upgradeIds ?? [];

  const techBuildings = units.getAlive().filter(unit => unit.unitType !== undefined && isTechBuilding(unit) && unit.isFinished());

  techBuildings.forEach(building => {
    const buildingType = building.unitType;
    if (buildingType !== undefined) {
      /** @type {number[]} */
      const availableUpgrades = upgradeAbilities[buildingType] || [];
      availableUpgrades.forEach(upgradeId => {
        if (!currentUpgrades.includes(upgradeId)) {
          const upgradeActions = upgrade(world, upgradeId);
          actionList.push(...upgradeActions);
        }
      });
    }
  });
};

/**
 * Sends available scout units to explore the map.
 * @param {World} world - The world instance controlling the game actions.
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList - The list of actions to be executed.
 */
const scout = async (world, actionList) => {
  const { units, frame } = world.resources.get();

  // Check if there's an active scout
  if (handleActiveScout(world)) {
    return; // An active scout is already exploring, no need to send another
  }

  const scouts = units.getAlive().filter(unit => unit.unitType !== undefined && scoutUnitTypes.includes(unit.unitType) && unit.isFinished());
  const gameInfo = frame.getGameInfo();
  const enemyStartLocations = gameInfo?.startRaw?.startLocations ?? []; // Accessing enemy start locations through the game info

  if (scouts.length > 0 && enemyStartLocations.length > 0) {
    const suitableScouts = scouts.filter(unit => isSuitableForScouting(units, unit)); // Filter suitable scouts

    if (suitableScouts.length > 0) {
      const scout = suitableScouts[0];
      if (scout.tag !== undefined) {
        const scoutPos = enemyStartLocations[0];
        const moveActions = createMoveCommand(parseInt(scout.tag), scoutPos); // Create the move command
        actionList.push(moveActions); // Add the move command to the actionList
        scout.addLabel('scouting', true); // Mark the unit as scouting
        setActiveScoutTag(scout.tag); // Set the active scout tag
      } else {
        console.error('Scout unit tag is undefined');
      }
    } else {
      console.error('No suitable scouts available');
    }
  }
};

module.exports = {
  midGameTransition,
};