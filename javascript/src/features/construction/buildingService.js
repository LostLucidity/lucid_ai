// buildingService.js
"use strict";

const { UnitType } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");
const { TownhallRace, GasMineRace } = require("@node-sc2/core/constants/race-map");

const { getUnitsCapableToAddOn } = require("./addonUtils");
const BuildingPlacement = require("./buildingPlacement");
const { getInTheMain, determineBuildingPosition, findBestPositionForAddOn, isPlaceableAtGasGeyser } = require("./buildingPlacementUtils");
const config = require("../../../config/config");
const { attemptBuildAddOn, addEarmark, attemptLiftOff } = require("../../core/common/buildUtils");
const { getEarmarkedFood, earmarks } = require("../../core/common/EarmarkManager");
const { attemptLand } = require("../../gameLogic/building/buildingUtils");
const { getNextSafeExpansions } = require("../../gameLogic/spatial/pathfinding");
const { findPlacements, findPosition } = require("../../gameLogic/spatial/spatialUtils");
const { calculateDistance } = require("../../gameLogic/unit/coreUtils");
const { getTimeUntilUnitCanBuildAddon } = require("../../gameLogic/utils/gameMechanics/unitUtils");
const { prepareUnitToBuildAddon } = require("../../gameLogic/utils/shared/unitPreparationUtils");
const { commandBuilderToConstruct } = require("../../gameLogic/workerManagementUtils");
const { GameState } = require("../../gameState");
const MapResources = require("../../gameState/mapResources");
const { checkAddOnPlacement } = require("../../services/ConstructionSpatialService");
const { getPendingOrders } = require("../../sharedServices");
const { flyingTypesMapping } = require("../../units/management/unitConfig");
const { updateAddOnType, getUnitTypeToBuild } = require("../../units/management/unitHelpers");
const { buildWithNydusNetwork, premoveBuilderToPosition, morphStructureAction } = require("../actions/unitActionsUtils");
const { commandPlaceBuilding } = require("../misc/builderUtils");
const { getAbilityIdsForAddons, getUnitTypesWithAbilities, getTimeToTargetTech } = require("../misc/gameData");

const foodEarmarks = new Map();

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

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {number} [targetCount=null]
 * @param {Point2D[]} [candidatePositions=[]]
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function build(world, unitType, targetCount = undefined, candidatePositions = []) {
  const { addonTypes } = groupTypes;
  const { BARRACKS, ORBITALCOMMAND, GREATERSPIRE } = UnitType;
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const gameState = GameState.getInstance();
  const effectiveTargetCount = targetCount === undefined ? Number.MAX_SAFE_INTEGER : targetCount;

  // Check if a Pylon is needed and if it exists for Protoss buildings
  if (agent.race === Race.PROTOSS && requiresPylonPower(unitType)) {
    const pylons = units.getByType(UnitType.PYLON);
    if (pylons.length === 0) {
      // Add logic to handle the situation when there are no Pylons
      return collectedActions;
    }
  }

  if (gameState.getUnitTypeCount(world, unitType) <= effectiveTargetCount &&
    gameState.getUnitCount(world, unitType) <= effectiveTargetCount) {
    const { race } = agent;

    // Check if race is defined
    if (race === undefined) {
      console.error('Race is undefined');
      return collectedActions;
    }

    switch (true) {
      case TownhallRace[race].includes(unitType):
        if (TownhallRace[race].indexOf(unitType) === 0) {
          if (units.getBases().length == 2 && agent.race === Race.TERRAN) {
            // Await the promise and then assign its value to candidatePositions
            candidatePositions = getInTheMain(world, unitType);
            const position = determineBuildingPosition(
              world,
              unitType,
              candidatePositions,
              BuildingPlacement.buildingPosition,
              findPlacements,
              findPosition,
              BuildingPlacement.setBuildingPosition
            );
            if (position === false) {
              console.error(`No valid position found for building type ${unitType}`);
              return collectedActions;
            }
            collectedActions.push(...commandPlaceBuilding(world, unitType, position, commandBuilderToConstruct, buildWithNydusNetwork, premoveBuilderToPosition, isPlaceableAtGasGeyser, getTimeToTargetCost));
          } else {
            const availableExpansions = MapResources.getAvailableExpansions(resources);
            const nextSafeExpansions = getNextSafeExpansions(world, availableExpansions);
            if (nextSafeExpansions.length > 0) {
              candidatePositions.push(nextSafeExpansions[0]);
              const position = determineBuildingPosition(
                world,
                unitType,
                candidatePositions,
                BuildingPlacement.buildingPosition,
                findPlacements,
                findPosition,
                BuildingPlacement.setBuildingPosition
              );

              if (position === false) {
                console.error(`No valid position found for building type ${unitType}`);
                return collectedActions;
              }

              collectedActions.push(...commandPlaceBuilding(world, unitType, position || null, commandBuilderToConstruct, buildWithNydusNetwork, premoveBuilderToPosition, isPlaceableAtGasGeyser, getTimeToTargetCost));
            }
          }
        } else {
          const unitTypeToCheckAfford = unitType === ORBITALCOMMAND ? BARRACKS : unitType;
          if (agent.canAfford(unitTypeToCheckAfford)) {
            collectedActions.push(...morphStructureAction(world, unitType));
          }
          addEarmark(data, data.getUnitTypeData(unitType));
        }
        break;
      case addonTypes.includes(unitType): {
        const abilityIds = getAbilityIdsForAddons(data, unitType);
        const canDoTypes = getUnitTypesWithAbilities(data, abilityIds);
        const canDoTypeUnits = units.getById(canDoTypes);
        // First, get the units that can perform the action regardless of affordability
        if (agent.canAfford(unitType)) {
          const allUnits = getUnitsCapableToAddOn(canDoTypeUnits);

          let fastestAvailableUnit = null;
          let fastestAvailableTime = Infinity;

          // Calculate time until each unit can build the add-on
          for (let unit of allUnits) {
            let timeUntilAvailable = getTimeUntilUnitCanBuildAddon(world, unit);
            if (timeUntilAvailable < fastestAvailableTime) {
              fastestAvailableUnit = unit;
              fastestAvailableTime = timeUntilAvailable;
            }
          }

          // If a suitable unit is found, build the add-on with it
          if (fastestAvailableUnit) {
            addEarmark(data, data.getUnitTypeData(unitType));
            collectedActions.push(...addAddOn(world, fastestAvailableUnit, unitType));
          }
        } else {
          const timeUntilCanBeAfforded = getTimeUntilCanBeAfforded(world, unitType);
          const allUnits = getUnitsCapableToAddOn(canDoTypeUnits);

          let fastestAvailableUnit = null;
          let fastestAvailableTime = Infinity;

          // Calculate time until each unit can build the addon
          for (let unit of allUnits) {
            let timeUntilAvailable = getTimeUntilUnitCanBuildAddon(world, unit);
            if (timeUntilAvailable < fastestAvailableTime) {
              fastestAvailableUnit = unit;
              fastestAvailableTime = timeUntilAvailable;
            }
          }
          // Check if we have a suitable unit to build the addon soon
          if (fastestAvailableUnit && fastestAvailableTime >= timeUntilCanBeAfforded) {
            // Prepare the fastest available unit to build the addon
            // TODO: Implement a function to prepare the unit to build the addon
            let targetPosition = findBestPositionForAddOn(world, fastestAvailableUnit, checkAddOnPlacement);
            collectedActions.push(...prepareUnitToBuildAddon(world, fastestAvailableUnit, targetPosition));
          }
        }
        break;
      }
      default:
        if (unitType === GREATERSPIRE) {
          collectedActions.push(...morphStructureAction(world, unitType));
        } else {
          const position = determineBuildingPosition(
            world,
            unitType,
            candidatePositions,
            BuildingPlacement.buildingPosition,
            findPlacements,
            findPosition,
            BuildingPlacement.setBuildingPosition
          );
          if (position === false) {
            console.error(`No valid position found for building type ${unitType}`);
            return collectedActions;
          } else {
            collectedActions.push(...commandPlaceBuilding(world, unitType, position, commandBuilderToConstruct, buildWithNydusNetwork, premoveBuilderToPosition, isPlaceableAtGasGeyser, getTimeToTargetCost));
          }
        }
    }
  }

  return collectedActions;
}

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
 * Check for gas mine construction conditions and initiate building if criteria are met.
 * @param {World} world - The game world context.
 * @param {number} targetRatio - Optional ratio of minerals to vespene gas to maintain.
 * @param {(world: World, unitType: number, targetCount?: number | undefined, candidatePositions?: Point2D[] | undefined) => SC2APIProtocol.ActionRawUnitCommand[]} buildFunction - The function to build the gas mine.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
const gasMineCheckAndBuild = (world, targetRatio = 2.4, buildFunction) => {
  const { agent, data, resources } = world;
  const { map, units } = resources.get();
  const { minerals, vespene } = agent;
  const resourceRatio = (minerals ?? 0) / (vespene ?? 1);
  const gasUnitId = GasMineRace[agent.race || Race.TERRAN];
  const buildAbilityId = data.getUnitTypeData(gasUnitId).abilityId;
  if (buildAbilityId === undefined) return [];

  const [geyser] = map.freeGasGeysers();
  const conditions = [
    resourceRatio > targetRatio,
    agent.canAfford(gasUnitId),
    units.getById(gasUnitId).filter(unit => (unit.buildProgress ?? 0) < 1).length < 1,
    config.planMax && config.planMax.gasMine ? (agent.foodUsed ?? 0) > config.planMax.gasMine : units.getById(gasUnitId).length > 2,
    units.withCurrentOrders(buildAbilityId).length <= 0,
    geyser,
  ];

  if (conditions.every(c => c)) {
    return buildFunction(world, gasUnitId);
  }

  return [];
};

/**
 * Retrieves gas geysers near a given position.
 * @param {UnitResource} units - The units resource object.
 * @param {Point2D} pos - The position to check near.
 * @param {number} [radius=8] - The radius within which to search for gas geysers.
 * @returns {Unit[]} - Array of gas geyser units near the given position.
 */
function getGasGeysersNearby(units, pos, radius = 8) {
  const gasGeysers = units.getGasGeysers();
  return gasGeysers.filter(geyser => {
    if (!geyser.pos) return false;
    return calculateDistance(pos, geyser.pos) <= radius;
  });
}

/**
 * Retrieves mineral fields near a given position.
 * @param {UnitResource} units - The units resource object.
 * @param {Point2D} pos - The position to check near.
 * @param {number} [radius=8] - The radius within which to search for mineral fields.
 * @returns {Unit[]} - Array of mineral field units near the given position.
 */
function getMineralFieldsNearby(units, pos, radius = 8) {
  const mineralFields = units.getMineralFields();
  return mineralFields.filter(field => {
    if (!field.pos) return false;
    return calculateDistance(pos, field.pos) <= radius;
  });
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number}
 **/
function getTimeToTargetCost(world, unitType) {
  const { agent, data, resources } = world;
  const { minerals } = agent;
  if (minerals === undefined) return Infinity;

  const { frame } = resources.get();
  const observation = frame.getObservation();
  if (!observation) return Infinity;

  const { score } = observation;
  if (!score) return Infinity;

  const { scoreDetails } = score;
  if (!scoreDetails) return Infinity;

  const collectionRunup = frame.getGameLoop() < 292;
  let { collectionRateMinerals, collectionRateVespene } = scoreDetails;
  if (collectionRateMinerals === undefined || collectionRateVespene === undefined) return Infinity;

  if (collectionRunup) {
    collectionRateMinerals = 615;
    collectionRateVespene = 0;
  }

  addEarmark(data, data.getUnitTypeData(unitType));
  let earmarkTotals = data.getEarmarkTotals('');
  const { minerals: earmarkMinerals, vespene: earmarkVespene } = earmarkTotals;
  const mineralsLeft = earmarkMinerals - minerals;
  const vespeneLeft = earmarkVespene - (agent.vespene ?? 0);
  const mineralCollectionRate = collectionRateMinerals / 60;
  if (mineralCollectionRate === 0) return Infinity;

  const timeToTargetMinerals = mineralsLeft / mineralCollectionRate;
  const { vespeneCost } = data.getUnitTypeData(unitType);
  if (vespeneCost === undefined) return Infinity;

  const vespeneCollectionRate = collectionRateVespene / 60;
  let timeToTargetVespene = 0;
  if (vespeneCost > 0) {
    if (vespeneCollectionRate === 0) return Infinity;
    timeToTargetVespene = vespeneLeft / vespeneCollectionRate;
  }

  return Math.max(timeToTargetMinerals, timeToTargetVespene);
}

/**
 * Calculates the time in seconds until the agent can afford the specified unit type.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number} The time in seconds until the unit can be afforded.
 */
function getTimeUntilCanBeAfforded(world, unitType) {
  const timeToTargetCost = getTimeToTargetCost(world, unitType);
  const timeToTargetTech = getTimeToTargetTech(world, unitType);

  // The time until the unit can be afforded is the maximum of the two times
  return Math.max(timeToTargetCost, timeToTargetTech);
}

/**
 * Checks if there are any earmarked resources.
 * @param {DataStorage} data
 * @returns {boolean}
 */
const hasEarmarks = (data) => {
  const earmarkTotals = data.getEarmarkTotals('');
  return earmarkTotals.minerals > 0 || earmarkTotals.vespene > 0;
};

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 */
function haveSupplyForUnit(world, unitType) {
  const { agent, data } = world;
  const { foodCap } = agent; if (foodCap === undefined) return false;
  const gameState = GameState.getInstance();
  const foodUsed = gameState.getFoodUsed();
  const earmarkedFood = getEarmarkedFood();
  const { foodRequired } = data.getUnitTypeData(unitType); if (foodRequired === undefined) return false;
  const supplyLeft = foodCap - foodUsed - earmarkedFood - foodRequired;
  return supplyLeft >= 0;
}

/**
 * Resets all earmarks.
 * 
 * Assuming `data` is an object that has a method `get` which returns an array,
 * and a method `settleEarmark` which takes a string.
 * This function clears both general and food earmarks.
 * 
 * @param {{ get: (key: string) => Earmark[], settleEarmark: (name: string) => void }} data The data object
 */
function resetEarmarks(data) {
  // Clear general earmarks
  earmarks.length = 0;
  data.get('earmarks').forEach((earmark) => data.settleEarmark(earmark.name));

  // Clear food earmarks
  foodEarmarks.clear();
}

// Export the functions to be used by other modules
module.exports = {
  build,
  buildSupply,
  gasMineCheckAndBuild,
  getGasGeysersNearby,
  getMineralFieldsNearby,
  getTimeToTargetCost,
  hasEarmarks,
  haveSupplyForUnit,
  resetEarmarks,
};

/**
 * Checks if the given Protoss unit type requires Pylon power.
 * @param {UnitTypeId} unitType The type of the Protoss unit.
 * @returns {boolean} True if the unit requires Pylon power, false otherwise.
 */
function requiresPylonPower(unitType) {
  const noPylonRequired = [UnitType.NEXUS, UnitType.ASSIMILATOR, UnitType.PYLON];
  return !noPylonRequired.includes(unitType);
}
