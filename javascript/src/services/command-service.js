//@ts-check
"use strict"

/**
 * This service handles the creation of unit commands.
 */

const { Ability, UnitType } = require("@node-sc2/core/constants");
const { keepPosition } = require("../../services/placement-service");
const planService = require("../../services/plan-service");
const { Alliance } = require("@node-sc2/core/constants/enums");
const getRandom = require("@node-sc2/core/utils/get-random");
const { createUnitCommand } = require("./shared-utilities/command-utilities");
const unitService = require("../../services/unit-service");
const { flyingTypesMapping } = require("../../helper/groups");
const dataService = require("../../services/data-service");
const { addEarmark } = require("./shared-utilities/common-utilities");
const { prepareBuilderForConstruction } = require("./resource-management");
const { commandBuilderToConstruct } = require("./unit-commands/builder-commands");
const { getBuilder } = require("./unit-commands/building-commands");
const { premoveBuilderToPosition } = require("./shared-utilities/builder-utils");

/**
 * @param {World} world 
 * @param {AbilityId} abilityId 
 * @returns {Promise<any[]>}
 */
async function ability(world, abilityId) {
  const { getPendingOrders, setPendingOrders } = unitService;
  const { data, resources } = world;
  const { units } = resources.get();
  const collectedActions = [];

  const flyingTypesKeys = [...flyingTypesMapping.keys()];

  let canDoTypes = data.findUnitTypesWithAbility(abilityId)
    .map(unitTypeId => {
      const key = flyingTypesKeys.find(key => flyingTypesMapping.get(key) === unitTypeId);
      return key ? [unitTypeId, key] : [unitTypeId];
    }).flat();

  if (canDoTypes.length === 0) {
    canDoTypes = units.getAlive(Alliance.SELF).reduce((/** @type {UnitTypeId[]} */acc, unit) => {
      if (unit.unitType) {
        acc.push(unit.unitType);
      }
      return acc;
    }, []);
  }

  const unitsCanDo = units.getById(canDoTypes);
  if (!unitsCanDo.length) return collectedActions;

  const unitsCanDoWithAbilityAvailable = unitsCanDo.filter(unit =>
    unit.abilityAvailable(abilityId) && getPendingOrders(unit).length === 0);

  let unitCanDo = getRandom(unitsCanDoWithAbilityAvailable);

  if (!unitCanDo) {
    const idleOrAlmostIdleUnits = unitsCanDo.filter(unit =>
      isIdleOrAlmostIdle(data, unit) && getPendingOrders(unit).length === 0);

    unitCanDo = getRandom(idleOrAlmostIdleUnits);
  }

  if (unitCanDo) {
    const unitCommand = createUnitCommand(abilityId, [unitCanDo]);
    setPendingOrders(unitCanDo, unitCommand);
    if (unitCanDo.abilityAvailable(abilityId)) {
      collectedActions.push(unitCommand);
    }
  }

  return collectedActions;
}

/**
 * Creates a command to move a unit to a specified position.
 * 
 * @param {Unit} unit - The unit to move.
 * @param {Point2D} position - The destination position.
 * @returns {SC2APIProtocol.ActionRawUnitCommand | null} - The move command.
 */
function createMoveCommand(unit, position) {
  if (unit.tag) {
    return {
      abilityId: Ability.MOVE,
      targetWorldSpacePos: position,
      unitTags: [unit.tag],
    };
  } else {
    return null;
  }
}

/**
 * Command to place a building at the specified position.
 * 
 * @param {World} world The current world state.
 * @param {number} unitType The type of unit/building to place.
 * @param {?Point2D} position The position to place the unit/building, or null if no valid position.
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>} A promise containing a list of raw unit commands.
 */
async function commandPlaceBuilding(world, unitType, position) {
  const { PYLON } = UnitType;
  const { agent, data, resources } = world;
  const { actions, units } = resources.get();
  const collectedActions = [];

  const unitTypeData = data.getUnitTypeData(unitType);
  if (!unitTypeData || typeof unitTypeData.abilityId === 'undefined') {
    return collectedActions; // return an empty array early
  }

  const abilityId = unitTypeData.abilityId;

  if (position) {
    const unitTypes = data.findUnitTypesWithAbility(abilityId);

    if (!unitTypes.includes(UnitType.NYDUSNETWORK)) {
      if (agent.canAfford(unitType)) {
        const canPlaceOrFalse = await actions.canPlace(unitType, [position]);
        position = (canPlaceOrFalse === false && !keepPosition(world, unitType, position)) ? null : position;

        if (position) {
          // Prepare the builder for the task
          const builder = prepareBuilderForConstruction(world, unitType, position);
          if (builder) {
            collectedActions.push(...commandBuilderToConstruct(world, builder, unitType, position));
          } else {
            // No builder found. Handle the scenario or add a fallback mechanism.
          }
        } else if (position !== null) {  // Check if position is not null
          planService.pausePlan = false;
          planService.continueBuild = true;
        }
      } else {
        // When you cannot afford the structure, you might want to move the builder close to the position 
        // so it's ready when you can afford it. 
        // This logic needs to be implemented if it's the desired behavior.
      }
    } else {
      collectedActions.push(...await buildWithNydusNetwork(world, unitType, abilityId));
    }

    const [pylon] = units.getById(PYLON);
    if (pylon && typeof pylon.buildProgress !== 'undefined' && pylon.buildProgress < 1 && pylon.pos && typeof pylon.unitType !== 'undefined') {
      collectedActions.push(...premoveBuilderToPosition(world, pylon.pos, pylon.unitType, getBuilder));
      planService.pausePlan = true;
      planService.continueBuild = false;
    }
  }
  return collectedActions;
}

module.exports = {
  ability,
  createMoveCommand,
  commandPlaceBuilding,
};

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 * @param {AbilityId} abilityId
 * @return {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
 */
async function buildWithNydusNetwork(world, unitType, abilityId) {
  const { agent, resources, data } = world;
  const { actions, units } = resources.get();
  const collectedActions = [];
  const nydusNetworks = units.getById(UnitType.NYDUSNETWORK, { alliance: Alliance.SELF });

  if (nydusNetworks.length > 0) {
    // randomly pick a nydus network
    const nydusNetwork = getRandom(nydusNetworks);

    if (agent.canAfford(unitType)) {
      if (planService.foundPosition && await actions.canPlace(unitType, [planService.foundPosition])) {
        const unitCommand = createUnitCommand(abilityId, [nydusNetwork]);
        unitCommand.targetWorldSpacePos = planService.foundPosition;
        collectedActions.push(unitCommand);
        planService.pausePlan = false;
        planService.continueBuild = true;
        addEarmark(data, data.getUnitTypeData(unitType));
        planService.foundPosition = false;
      } else {
        planService.foundPosition = false;
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
  }

  return collectedActions;
}

/**
 * @param {DataStorage} data
 * @param {Unit} unit
 * @returns {boolean}
 */
function isIdleOrAlmostIdle(data, unit) {
  // if the unit is idle, no need to check anything else
  if (unit.orders && unit.orders.length === 0 && unit.buildProgress && unit.buildProgress === 1) {
    return true;
  }

  // now check if it is almost idle
  const { abilityId = null, progress = null } = (unit.orders && unit.orders.length > 0) ? unit.orders[0] : {};
  let unitTypeTraining;
  if (abilityId !== null) {
    unitTypeTraining = dataService.unitTypeTrainingAbilities.get(abilityId);
  }
  const unitTypeData = unitTypeTraining && data.getUnitTypeData(unitTypeTraining);
  const { buildTime } = unitTypeData || {};
  let buildTimeLeft;
  if (buildTime !== undefined && progress !== null) {
    buildTimeLeft = unitService.getBuildTimeLeft(unit, buildTime, progress);
  }
  const isAlmostIdle = buildTimeLeft !== undefined && buildTimeLeft <= 8 && unitService.getPendingOrders(unit).length === 0;
  return isAlmostIdle;
}