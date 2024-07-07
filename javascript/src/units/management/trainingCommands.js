// trainingCommands.js

const { UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");

const { getDistance } = require("../../features/shared/pathfinding/spatialCoreUtils");

const pylonsPowerRadius = 6.5;

/**
 * Creates training commands for a list of trainers.
 * @param {World} world The game world context.
 * @param {Unit[]} trainers List of units that can train others.
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData Data about the unit type being trained.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of training commands.
 */
function createTrainingCommands(world, trainers, unitTypeData) {
  return trainers.reduce((commands, trainer) => {
    if (!trainer.unitType || !unitTypeData.unitId) return commands;

    const abilityId = getAbilityIdForTrainer(world, trainer.unitType, unitTypeData.unitId);
    if (!abilityId) return commands;

    const unitTags = typeof trainer.tag === 'string' ? [trainer.tag] : [];
    const targetWorldSpacePos = (trainer.unitType === UnitType.WARPGATE)
      ? findWarpInLocation(world, trainer)
      : undefined;

    commands.push({
      abilityId,
      unitTags,
      targetWorldSpacePos,
      queueCommand: false,
    });

    return commands;
  }, /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */([]));
}

/**
 * Finds a suitable warp-in location for the given trainer.
 * @param {World} world - The game world context.
 * @param {Unit} trainer - The trainer unit (WARPGATE).
 * @returns {SC2APIProtocol.Point2D} The warp-in location.
 */
function findWarpInLocation(world, trainer) {
  const pos = trainer.pos;
  if (!pos) {
    // Fallback if position is undefined
    return { x: 0, y: 0 };
  }

  const range = 10; // Range to search for a suitable location
  const step = 1; // Step size for searching locations

  /**
   * Checks if the position is suitable for warp-in.
   * @param {number} x - The x coordinate.
   * @param {number} y - The y coordinate.
   * @returns {boolean} True if the location is suitable, false otherwise.
   */
  function isSuitableLocation(x, y) {
    const units = world.resources.get().units.getAll();
    // Check for nearby enemy units
    const enemiesNearby = units.some(unit => unit.alliance === Alliance.ENEMY && unit.pos && getDistance(unit.pos, { x, y }) < range);
    // Check for nearby friendly units
    const friendliesNearby = units.some(unit => unit.alliance === Alliance.SELF && unit.pos && getDistance(unit.pos, { x, y }) < step);

    // Check if the location is within pylon power
    const pylons = units.filter(unit => unit.unitType === UnitType.PYLON && unit.isPowered);
    const isPowered = pylons.some(pylon => getDistance(pylon.pos, { x, y }) < pylonsPowerRadius);

    // Check if the location is valid for placement and pathable
    const isBuildable = world.resources.get().map.isPlaceable({ x, y });
    const isPathable = world.resources.get().map.isPathable({ x, y });

    return !enemiesNearby && !friendliesNearby && isPowered && isBuildable && isPathable;
  }

  // Iterate through potential positions within the given range
  for (let dx = -range; dx <= range; dx += step) {
    for (let dy = -range; dy <= range; dy += step) {
      const x = (pos?.x ?? 0) + dx;
      const y = (pos?.y ?? 0) + dy;
      if (isSuitableLocation(x, y)) {
        return { x, y };
      }
    }
  }

  // Fallback to the trainer's current position if no suitable location is found
  return { x: pos?.x ?? 0, y: pos?.y ?? 0 };
}

/**
 * Gets the appropriate ability ID for training a unit type based on the trainer's unit type.
 * @param {World} world - The game world context.
 * @param {number} trainerUnitType - The unit type of the trainer (e.g., GATEWAY or WARPGATE).
 * @param {number} unitTypeId - The type ID of the unit to train.
 * @returns {number|undefined} The appropriate ability ID or undefined if not found.
 */
function getAbilityIdForTrainer(world, trainerUnitType, unitTypeId) {
  if (trainerUnitType === UnitType.WARPGATE) {
    return WarpUnitAbility[unitTypeId];
  } else {
    const unitTypeData = world.data.getUnitTypeData(unitTypeId);
    return unitTypeData ? unitTypeData.abilityId : undefined;
  }
}

module.exports = {
  createTrainingCommands
};
