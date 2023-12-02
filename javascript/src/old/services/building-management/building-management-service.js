//@ts-check
"use strict"

// === IMPORTS & CONSTANTS ===
const { UnitType } = require("@node-sc2/core/constants");
const groupTypes = require("@node-sc2/core/constants/groups");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { Race } = require("@node-sc2/core/constants/enums");
const { PlacementService } = require("../placement");
const { commandPlaceBuilding } = require("../command-service");
const { addEarmark } = require("../../shared-utilities/common-utilities");
const { prepareBuilderForConstruction } = require("../resource-management");
const { commandBuilderToConstruct } = require("../unit-commands/builder-commands");
const { morphStructureAction } = require("../../shared-utilities/building-utils");
const { getBuilder } = require("../unit-commands/building-commands");
const { premoveBuilderToPosition } = require("../../shared-utilities/builder-utils");
const unitRetrievalService = require("../unit-retrieval");

// === FUNCTION DEFINITIONS ===

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {number} [targetCount=null]
 * @param {Point2D[]} [candidatePositions=[]]
 * @returns {Promise<void>}
 */
async function build(world, unitType, targetCount = null, candidatePositions = []) {
  const { addonTypes } = groupTypes;
  const { BARRACKS, ORBITALCOMMAND, GREATERSPIRE } = UnitType;
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];
  const { agent, data, resources } = world;
  const { actions, units } = resources.get();

  if (targetCount === null || (unitRetrievalService.getUnitTypeCount(world, unitType) <= targetCount && unitRetrievalService.getUnitCount(world, unitType) <= targetCount)) {
    const { race } = agent;
    switch (true) {
      case TownhallRace[race].includes(unitType):
        if (TownhallRace[race].indexOf(unitType) === 0) {
          if (units.getBases().length == 2 && agent.race === Race.TERRAN) {
            candidatePositions = await getInTheMain(resources, unitType);
            const position = PlacementService.determineBuildingPosition(world, unitType, candidatePositions);
            collectedActions.push(...await commandPlaceBuilding(world, unitType, position));
          } else {
            const availableExpansions = getAvailableExpansions(resources);
            const nextSafeExpansions = getNextSafeExpansions(world, availableExpansions);
            if (nextSafeExpansions.length > 0) {
              candidatePositions.push(nextSafeExpansions[0]);
              const position = PlacementService.determineBuildingPosition(world, unitType, candidatePositions);
              collectedActions.push(...await commandPlaceBuilding(world, unitType, position));
            }
          }
        } else {
          const unitTypeToCheckAfford = unitType === ORBITALCOMMAND ? BARRACKS : unitType;
          if (agent.canAfford(unitTypeToCheckAfford)) {
            collectedActions.push(...await morphStructureAction(world, unitType));
          }
          addEarmark(data, data.getUnitTypeData(unitType));
        }
        break;
      case addonTypes.includes(unitType):
        // ... (rest of the addonTypes case remains the same)
        break;
      default:
        if (unitType === GREATERSPIRE) {
          collectedActions.push(...await morphStructureAction(world, unitType));
        } else {
          const position = PlacementService.determineBuildingPosition(world, unitType, candidatePositions);
          collectedActions.push(...await commandPlaceBuilding(world, unitType, position));
        }
    }
  }
  if (collectedActions.length > 0) {
    const response = await actions.sendAction(collectedActions);
    if (response.result === undefined) return;
  }
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
 */
async function buildGasMine(world, unitType) {
  const { agent, resources } = world;
  const { actions, map } = resources.get();
  const collectedActions = [];

  const freeGasGeysers = MapResourceService.getFreeGasGeysers(map);
  if (freeGasGeysers.length === 0) return collectedActions;

  try {
    const { pos } = freeGasGeysers[0];
    if (pos === undefined) return collectedActions;

    if (agent.canAfford(unitType)) {
      const builder = prepareBuilderForConstruction(world, unitType, pos);

      if (builder) {
        const constructionActions = commandBuilderToConstruct(world, builder, unitType, pos);
        await actions.sendAction(constructionActions);
        planService.pausePlan = false;
      }
    } else {
      collectedActions.push(...premoveBuilderToPosition(world, pos, unitType, getBuilder));
    }
  } catch (error) {
    console.log(error);
  }

  return collectedActions;
}

module.exports = {
  build,
  buildGasMine,
  premoveBuilderToPosition,
};
