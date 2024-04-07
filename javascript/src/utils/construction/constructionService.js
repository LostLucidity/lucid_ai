// src/features/construction/constructionService.js

const { UnitType } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");

const { getTimeToTargetCost, addEarmark } = require("./resourceManagement");
const config = require("../../../config/config");
const GameState = require("../../core/gameState");
const { premoveBuilderToPosition } = require("../../features/construction/constructionAndBuildingUtils");
const { commandBuilderToConstruct, buildWithNydusNetwork } = require("../../features/construction/constructionUtils");
const { attemptLand } = require("../../gameLogic/landingUtils");
const { getPendingOrders } = require("../../sharedServices");
const { isPlaceableAtGasGeyser } = require("../common/utils");
const { commandPlaceBuilding } = require("../misc/builderUtils");
const { attemptBuildAddOn, attemptLiftOff } = require("../sharedUnitConstruction");
const { findPlacements } = require("../spatial/spatialUtils");
const { flyingTypesMapping } = require("../training/unitConfig");
const { getUnitTypeToBuild, updateAddOnType } = require("../unit/unitHelpers");

/**
 * @param {World} world
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function buildSupply(world) {
  const { agent } = world;
  const { foodUsed, minerals } = agent;

  // Explicitly define the type of actions
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const actions = [];

  if (foodUsed === undefined || minerals === undefined) return actions;

  const isSupplyNeeded = (/** @type {World} */ world, /** @type {number} */ threshold) => {
    const { foodCap, foodUsed } = world.agent;

    // Check if foodCap or foodUsed is undefined before proceeding
    if (foodCap === undefined || foodUsed === undefined) {
      console.error('foodCap or foodUsed is undefined');
      return false;
    }

    return foodCap - foodUsed < threshold;
  };

  const greaterThanPlanSupply = foodUsed > config.planMax.supply;
  const automateSupplyCondition = isSupplyNeeded(world, 0.2) &&
    (greaterThanPlanSupply || minerals > 512) &&
    config.automateSupply;

  if (automateSupplyCondition) {
    switch (agent.race) {
      case Race.TERRAN: {
        const candidatePositionsTerran = findPlacements(world, UnitType.SUPPLYDEPOT);
        actions.push(...candidatePositionsTerran.map(pos => commandPlaceBuilding(
          world,
          UnitType.SUPPLYDEPOT,
          pos,
          commandBuilderToConstruct,
          buildWithNydusNetwork,
          premoveBuilderToPosition,
          isPlaceableAtGasGeyser,
          getTimeToTargetCost
        )).flat());
        break;
      }
      case Race.PROTOSS: {
        const candidatePositionsProtoss = findPlacements(world, UnitType.PYLON);
        actions.push(...candidatePositionsProtoss.map(pos => commandPlaceBuilding(
          world,
          UnitType.PYLON,
          pos,
          commandBuilderToConstruct,
          buildWithNydusNetwork,
          premoveBuilderToPosition,
          isPlaceableAtGasGeyser,
          getTimeToTargetCost
        )).flat());
        break;
      }
      case Race.ZERG: {
        // Zerg supply logic...
        break;
      }
    }
  }

  return actions;
}

/**
 * Adds addon, with placement checks and relocating logic.
 * @param {World} world 
 * @param {Unit} unit 
 * @param {UnitTypeId} addOnType 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function addAddOn(world, unit, addOnType) {
  const { landingAbilities, liftingAbilities } = groupTypes;
  const { data } = world;
  const { tag } = unit;
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];

  if (tag === undefined) return collectedActions;

  const gameState = GameState.getInstance();
  addOnType = updateAddOnType(addOnType, gameState.countTypes);
  const unitTypeToBuild = getUnitTypeToBuild(unit, flyingTypesMapping, addOnType);

  // Check if unitTypeToBuild is defined and retrieve abilityId
  if (unitTypeToBuild === undefined) return collectedActions;
  const unitTypeData = data.getUnitTypeData(unitTypeToBuild);
  if (!unitTypeData || unitTypeData.abilityId === undefined) return collectedActions;
  const abilityId = unitTypeData.abilityId;

  const unitCommand = { abilityId, unitTags: [tag] };

  if (!unit.noQueue || unit.labels.has('swapBuilding') || getPendingOrders(unit).length > 0) {
    return collectedActions;
  }

  const availableAbilities = unit.availableAbilities();

  if (unit.abilityAvailable(abilityId)) {
    const buildAddOnActions = attemptBuildAddOn(world, unit, addOnType, unitCommand);
    if (buildAddOnActions && buildAddOnActions.length > 0) {
      addEarmark(data, unitTypeData);
      collectedActions.push(...buildAddOnActions);
      return collectedActions;
    }
  }

  if (availableAbilities.some(ability => liftingAbilities.includes(ability))) {
    const liftOffActions = attemptLiftOff(unit);
    if (liftOffActions && liftOffActions.length > 0) {
      collectedActions.push(...liftOffActions);
      return collectedActions;
    }
  }

  if (availableAbilities.some(ability => landingAbilities.includes(ability))) {
    const landActions = attemptLand(world, unit, addOnType);
    collectedActions.push(...landActions);
  }

  return collectedActions;
}

module.exports = { buildSupply, addAddOn };
