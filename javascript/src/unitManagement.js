//@ts-check
"use strict";

// External library imports
const { UnitType, Ability, WarpUnitAbility } = require("@node-sc2/core/constants");
const { Alliance, Attribute, Race } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");
const { WorkerRace, GasMineRace } = require("@node-sc2/core/constants/race-map");
const UnitAbilityMap = require("@node-sc2/core/constants/unit-ability-map");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const getRandom = require("@node-sc2/core/utils/get-random");

// Internal dependencies
const StrategyManager = require("./buildOrders/strategy/strategyManager");
const BuildingPlacement = require("./construction/buildingPlacement");
const { buildSupply } = require("./construction/buildingService");
const GameState = require("./core/gameState");
const { getTimeToTargetTech } = require("./gameData");
const { getById } = require("./gameUtils");
const { getDistance } = require("./geometryUtils");
const { pointsOverlap } = require("./mapUtils");
const { getAddOnBuildingPlacement, landingGrids } = require("./placementUtils");
const { earmarkResourcesIfNeeded } = require("./sharedEconomicFunctions");
const { createTrainingCommands } = require("./unitActions");
const { flyingTypesMapping, liftAndLandingTime } = require("./unitConfig");
const { getUnitTypeCount, isTrainingUnit } = require("./unitHelpers");
const { setPendingOrders } = require("./unitOrders");
const { createUnitCommand, findKeysForValue } = require("./utils");
const { filterSafeTrainers } = require("./utils/gameLogic/gameStrategyUtils");
const { getPendingOrders } = require("./utils/gameLogic/stateManagement");
const { checkTechRequirement } = require("./utils/gameLogic/techRequirementUtils");
const { isTrainingOrder, canTrainUnit } = require("./utils/gameLogic/unitCapabilityUtils");
const { haveSupplyForUnit, getTimeToTargetCost } = require("./utils/resourceManagement/resourceManagement");
const { addEarmark, getEarmarkedFood } = require("./utils/resourceManagement/resourceUtils");
const { shortOnWorkers } = require("./workerUtils");

/** @type {Map<UnitTypeId, Unit[]>} */
const productionUnitsCache = new Map();

/** @type {boolean} */
let unitProductionAvailable = true;

/**
 * Build supply or train units based on the game world state and strategy step.
 * @param {World} world
 * @param {import("./buildOrders/strategy/strategyService").PlanStep} step
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function buildSupplyOrTrain(world, step) {
  let collectedActions = [];

  collectedActions.push(...handleSupplyBuilding(world, step));
  collectedActions.push(...handleUnitTraining(world, step));
  updateFoodUsed(world);

  return collectedActions;
}

/**
 * Check if unit can train now.
 * @param {World} world
 * @param {Unit} unit 
 * @param {UnitTypeId} unitType
 * @returns {boolean}
 */
const canTrainNow = (world, unit, unitType) => {
  if (!unit.orders || unit.buildProgress === undefined) return false;

  // Calculate the max orders and get the tech requirement once
  const maxOrders = unit.hasReactor() ? 2 : 1;
  const { techRequirement } = world.data.getUnitTypeData(unitType);

  // Check for tech requirements
  if (techRequirement && !checkTechRequirement(world.resources, techRequirement, unit)) {
    return false;
  }

  // Combine and filter orders in one go
  const currentAndPendingOrders = unit.orders
    .concat(getPendingOrders(unit))
    .filter(order => isTrainingOrder(order, world.data))
    .length;

  return currentAndPendingOrders < maxOrders;
}

/**
 * @param {World} world
 * @param {number} unitType
 */
function checkProductionAvailability(world, unitType) {
  const gameState = GameState.getInstance();
  if (gameState.availableProductionUnits.has(unitType)) {
    return gameState.availableProductionUnits.get(unitType) || false;
  }
  const haveAvailableProductionUnits = haveAvailableProductionUnitsFor(world, unitType);
  gameState.availableProductionUnits.set(unitType, haveAvailableProductionUnits);
  return haveAvailableProductionUnits;
}

/**
 * @param {UnitResource} units
 * @returns {UnitTypeId[]}
 */
function getExistingTrainingTypes(units) {
  return units.getAlive().reduce((/** @type {UnitTypeId[]} */ types, unit) => {
    const { unitType } = unit; if (unitType === undefined) { return types; }
    if (types.includes(unitType)) {
      return types;
    }
    return [...types, unitType];
  }, []);
}

/**
 * Calculates the difference in food supply needed for the next step of the build plan.
 * @param {World} world
 * @returns {number}
 */
function getFoodDifference(world) {
  const { agent, data } = world;
  const race = agent.race;

  // Check if race is defined
  if (race === undefined || !WorkerRace[race]) {
    return 0; // Return early or handle the undefined case
  }

  const workerRaceData = WorkerRace[race]; // Cache the value
  const { abilityId } = data.getUnitTypeData(workerRaceData);
  if (abilityId === undefined) {
    return 0;
  }

  const gameState = GameState.getInstance();
  const foodUsed = gameState.getFoodUsed();

  const strategyManager = StrategyManager.getInstance();
  const plan = strategyManager.getCurrentStrategy();

  // Check if plan is defined
  if (!plan) {
    console.error('Current strategy plan is undefined.');
    return 0;
  }

  const step = plan.steps.find(step => parseInt(step.supply, 10) >= foodUsed);
  const foodDifference = step ? parseInt(step.supply, 10) - foodUsed : 0;
  const productionUnitsCount = getProductionUnits(world, workerRaceData).length;
  const lowerOfFoodDifferenceAndProductionUnitsCount = Math.min(foodDifference, productionUnitsCount);

  let affordableFoodDifference = 0;
  for (let i = 0; i < lowerOfFoodDifferenceAndProductionUnitsCount; i++) {
    if (agent.canAfford(workerRaceData) && haveSupplyForUnit(world, workerRaceData)) {
      affordableFoodDifference++;
      addEarmark(data, data.getUnitTypeData(workerRaceData))
    } else {
      break;
    }
  }
  return affordableFoodDifference;
}

/**
 * Retrieves units capable of producing a specific unit type.
 * @param {World} world
 * @param {UnitTypeId} unitTypeId
 * @returns {Unit[]}
 */
function getProductionUnits(world, unitTypeId) {
  const { units } = world.resources.get();
  // Check if the result is in the cache
  if (productionUnitsCache.has(unitTypeId)) {
    return productionUnitsCache.get(unitTypeId) || [];
  }

  const { abilityId } = world.data.getUnitTypeData(unitTypeId); if (abilityId === undefined) return [];
  let producerUnitTypeIds = world.data.findUnitTypesWithAbility(abilityId);

  if (producerUnitTypeIds.length <= 0) {
    const alias = world.data.getAbilityData(abilityId).remapsToAbilityId; if (alias === undefined) return [];
    producerUnitTypeIds = world.data.findUnitTypesWithAbility(alias);
  }

  const result = units.getByType(producerUnitTypeIds);

  // Store the result in the cache
  productionUnitsCache.set(unitTypeId, result);

  return result;
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitTypeId
 * @returns {Unit[]}
 */
function getTrainer(world, unitTypeId) {
  const { WARPGATE } = UnitType;
  const { data, resources } = world;
  const { units } = resources.get();
  let { abilityId } = data.getUnitTypeData(unitTypeId); if (abilityId === undefined) return [];

  const unitFilter = (/** @type {Unit} */ unit) => {
    const { orders } = unit;
    const pendingOrders = getPendingOrders(unit);
    if (abilityId === undefined || orders === undefined || pendingOrders === undefined) return false;
    const allOrders = [...orders, ...pendingOrders];
    const spaceToTrain = allOrders.length === 0 || (unit.hasReactor() && allOrders.length < 2);
    return spaceToTrain && unit.abilityAvailable(abilityId) && !unit.labels.has('reposition');
  };

  let productionUnits = getProductionUnits(world, unitTypeId).filter(unitFilter);

  if (productionUnits.length === 0) {
    const abilityId = WarpUnitAbility[unitTypeId];
    productionUnits = units.getById(WARPGATE).filter(warpgate => abilityId && warpgate.abilityAvailable(abilityId));
  }

  // Check for flying units
  const unitTypesWithAbility = data.findUnitTypesWithAbility(abilityId);
  const flyingTypes = unitTypesWithAbility.flatMap(value => findKeysForValue(flyingTypesMapping, value));
  const flyingUnits = units.getById(flyingTypes).filter(unit => unit.isIdle());

  productionUnits = [...productionUnits, ...flyingUnits];

  return productionUnits;
}

/**
 * Handles the building of supply units.
 * @param {World} world
 * @param {import("./buildOrders/strategy/strategyService").PlanStep} step
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function handleSupplyBuilding(world, step) {
  const actions = [];
  const gameState = GameState.getInstance();
  const foodUsed = gameState.getFoodUsed() + getEarmarkedFood();
  const shouldBuildSupply = !step || foodUsed < step.food;

  if (shouldBuildSupply) {
    if (world.agent.race === Race.ZERG) {
      actions.push(...manageZergSupply(world));
    } else {
      actions.push(...buildSupply(world));
    }
  }

  return actions;
}

/**
 * @param {World} world
 * @param {number} unitTypeId
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData
 */
function handleTrainingActions(world, unitTypeId, unitTypeData) {
  const trainers = getTrainer(world, unitTypeId);
  const safeTrainers = filterSafeTrainers(world, trainers);
  return createTrainingCommands(world, safeTrainers, unitTypeData);
}

/**
 * Handles the training of units.
 * @param {World} world
 * @param {import("./buildOrders/strategy/strategyService").PlanStep} step
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function handleUnitTraining(world, step) {
  const actions = [];
  const gameState = GameState.getInstance();
  let foodUsed = gameState.getFoodUsed() + getEarmarkedFood();
  const foodDifference = step ? step.food - foodUsed : 0;

  let trainingOrders = shouldTrainWorkers(world) ? trainWorkers(world) : [];
  if (trainingOrders.length === 0) {
    trainingOrders = trainCombatUnits(world);
  }
  actions.push(...trainingOrders);

  if (trainingOrders.length === 0 && world.agent.race !== undefined && WorkerRace[world.agent.race]) {
    for (let i = 0; i < foodDifference; i++) {
      addEarmark(world.data, world.data.getUnitTypeData(WorkerRace[world.agent.race]));
    }
  }

  return actions;
}

/**
 * Check if unitType has prerequisites to build when minerals are available.
 * @param {World} world 
 * @param {UnitTypeId} unitType 
 * @returns {boolean}
 */
function haveAvailableProductionUnitsFor(world, unitType) {
  const { resources } = world;
  const { units } = resources.get();
  const warpInAbilityId = WarpUnitAbility[unitType];
  const productionUnits = getProductionUnits(world, unitType);
  return (
    units.getById(UnitType.WARPGATE).some(warpgate => warpgate.abilityAvailable(warpInAbilityId)) ||
    productionUnits.some(unit =>
      unit.buildProgress !== undefined &&
      unit.buildProgress >= 1 &&
      !unit.isEnemy() &&
      canTrainNow(world, unit, unitType)
    )
  );
}

/**
 * Manages Zerg supply by training Overlords as needed.
 * @param {World} world - The current game world context.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - Commands to train Overlords, if needed.
 */
function manageZergSupply(world) {
  const { agent, data, resources } = world;
  const { foodCap, foodUsed } = agent;
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const actions = [];

  if (foodCap !== undefined && foodUsed !== undefined && (foodCap - foodUsed < 8) && agent.canAfford(UnitType.OVERLORD)) {
    const overlordData = data.getUnitTypeData(UnitType.OVERLORD);
    if (overlordData && overlordData.abilityId !== undefined) {
      const larva = resources.get().units.getById(UnitType.LARVA);
      const abilityId = overlordData.abilityId; // Define abilityId here
      larva.forEach(larvaUnit => {
        if (larvaUnit.isIdle() && abilityId !== undefined) {
          // Ensure abilityId is defined before calling createUnitCommand
          const unitCommand = createUnitCommand(abilityId, [larvaUnit]);
          actions.push(unitCommand);
        }
      });
    }
  }

  return actions;
}

/**
 * Clears the production units cache.
 */
function refreshProductionUnitsCache() {
  productionUnitsCache.clear();
}

/**
 * Analyzes the game state and decides if workers should be trained.
 * @param {World} world - The current game world context.
 * @returns {boolean} - True if conditions are met for training workers, false otherwise.
 */
function shouldTrainWorkers(world) {
  const { agent: { minerals, race }, resources } = world;

  // Check if race and minerals are defined
  if (race === undefined || minerals === undefined) {
    return false; // Exit the function if race or minerals are undefined
  }

  const workerRaceData = WorkerRace[race]; // Cache the worker race data
  const workerCount = getById(resources, [workerRaceData]).length;
  const gasMineRaceData = GasMineRace[race]; // Cache the gas mine race data
  const assignedWorkerCount = [...resources.get().units.getBases(), ...getById(resources, [gasMineRaceData])]
    .reduce((acc, base) => (base.assignedHarvesters || 0) + acc, 0);
  const minimumWorkerCount = Math.min(workerCount, assignedWorkerCount);
  const foodDifference = getFoodDifference(world);
  const sufficientMinerals = minerals < 512 || minimumWorkerCount <= 36;
  const productionPossible = haveAvailableProductionUnitsFor(world, workerRaceData);
  const strategyManager = StrategyManager.getInstance();
  const notOutpoweredOrNoUnits = !strategyManager.getOutpowered() || (strategyManager.getOutpowered() && !unitProductionAvailable);

  return sufficientMinerals && (shortOnWorkers(world) || foodDifference > 0)
    && notOutpoweredOrNoUnits && productionPossible;
}

/**
 * Train a unit.
 * @param {World} world The current game world.
 * @param {UnitTypeId} unitTypeId Type of the unit to train.
 * @param {number | null} targetCount Target number of units.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function train(world, unitTypeId, targetCount = null) {
  const unitTypeData = world.data.getUnitTypeData(unitTypeId);
  if (!unitTypeData.abilityId) return [];

  let earmarkNeeded = targetCount && getUnitTypeCount(world, unitTypeId) < targetCount;

  if (!canTrainUnit(world, unitTypeId, targetCount)) return [];
  earmarkNeeded = earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);

  const collectedActions = handleTrainingActions(world, unitTypeId, unitTypeData);
  earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);

  return collectedActions;
}

/**
 * @param {World} world 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function trainCombatUnits(world) {
  const { OVERLORD } = UnitType;
  const { agent, data, resources } = world;
  const { minerals, vespene } = agent;
  if (minerals === undefined || vespene === undefined) return [];
  const { units } = resources.get();
  const collectedActions = [];

  const strategyManager = StrategyManager.getInstance();
  const currentStrategy = strategyManager.getCurrentStrategy();

  // Check if currentStrategy is defined
  if (!currentStrategy) {
    console.error('Current strategy is undefined.');
    return [];
  }

  const plannedTrainingTypes = strategyManager.getTrainingTypes().length > 0
    ? strategyManager.getTrainingTypes()
    : getExistingTrainingTypes(units);

  const currentStep = strategyManager.getCurrentStep();
  const currentPlanStep = currentStrategy.steps[currentStep];

  const gameState = GameState.getInstance();

  const candidateTypesToBuild = plannedTrainingTypes.filter(type => {
    const { attributes, foodRequired } = data.getUnitTypeData(type);
    if (attributes === undefined || foodRequired === undefined) return false;
    const supply = currentPlanStep ? parseInt(currentPlanStep.supply, 10) : 0;

    // Convert type to string for indexing UnitTypeId
    const unitTypeIdKey = String(type);
    const planMinForType = strategyManager.getPlanMin()[unitTypeIdKey];

    return (!attributes.includes(Attribute.STRUCTURE) && type !== OVERLORD) &&
      foodRequired <= supply - gameState.getFoodUsed() &&
      (strategyManager.getOutpowered()
        ? strategyManager.getOutpowered()
        : (planMinForType !== undefined ? planMinForType <= gameState.getFoodUsed() : true)) &&
      (!strategyManager.getUnitMax()[unitTypeIdKey]
        || (getUnitTypeCount(world, type) < strategyManager.getUnitMax()[unitTypeIdKey])) &&
      gameState.checkTechFor(agent, type) &&
      checkProductionAvailability(world, type);
  });

  if (candidateTypesToBuild.length > 0) {
    let selectedType = strategyManager.getSelectedTypeToBuild() !== null
      ? strategyManager.getSelectedTypeToBuild()
      : strategyManager.selectTypeToBuild(world, candidateTypesToBuild);

    if (selectedType !== undefined && selectedType !== null) {
      if (strategyManager.getOutpowered() || agent.canAfford(selectedType)) {
        collectedActions.push(...train(world, selectedType));
      }
    }
    strategyManager.setSelectedTypeToBuild(selectedType);
  }

  return collectedActions;
}

/**
 * Train workers for all races, considering the unique Zerg training mechanism and ability availability.
 * @param {World} world - The game world context, containing all necessary game state information.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of actions to be sent to the game.
 */
function trainWorkers(world) {
  const { agent, data, resources } = world;
  const { minerals, race } = agent;

  if (minerals === undefined || race === undefined) return [];

  const workerTypeId = WorkerRace[race]; // Assuming WorkerRace is a predefined mapping
  const workerTypeData = data.getUnitTypeData(workerTypeId);
  const { abilityId } = workerTypeData;

  if (!abilityId) return [];

  const collectedActions = [];

  if (race === Race.ZERG) {
    const larvae = resources.get().units.getById(UnitType.LARVA);
    for (const larva of larvae) {
      const pendingOrders = getPendingOrders(larva);
      const isAlreadyTraining = pendingOrders.some(order => order.abilityId === abilityId);

      if (larva.isIdle() && larva.abilityAvailable(abilityId) && !isAlreadyTraining) {
        const unitCommand = createUnitCommand(abilityId, [larva]);
        collectedActions.push(unitCommand);
        setPendingOrders(larva, unitCommand); // Update local state to reflect new order
        break; // Only issue one command per function call to manage resources efficiently
      }
    }
  } else {
    const bases = resources.get().units.getBases();
    for (const base of bases) {
      const pendingOrders = getPendingOrders(base);
      const isAlreadyTraining = pendingOrders.some(order => order.abilityId === abilityId);

      if (base.isIdle() && base.isFinished() && base.abilityAvailable(abilityId) && !isAlreadyTraining) {
        const unitCommand = createUnitCommand(abilityId, [base]);
        collectedActions.push(unitCommand);
        setPendingOrders(base, unitCommand); // Update local state to reflect new order
        break; // Issue command to the first eligible base only
      }
    }
  }

  return collectedActions;
}

/**
 * Update the food used in the game state.
 * @param {World} world 
 */
function updateFoodUsed(world) {
  const gameState = GameState.getInstance();
  gameState.setFoodUsed(world);
}

/**
 * Refactored to return a list of actions instead of sending them directly.
 * @param {World} world 
 * @param {number} upgradeId 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
 */
function upgrade(world, upgradeId) {
  const { BARRACKS, TECHLAB } = UnitType;
  const { techLabTypes } = groupTypes;
  const { agent, data, resources } = world;
  const { upgradeIds } = agent; 
  if (upgradeIds === undefined) return [];
  
  const { units } = resources.get();
  if (upgradeIds.includes(upgradeId)) return [];
  
  const upgraders = units.getUpgradeFacilities(upgradeId).filter(upgrader => upgrader.alliance === Alliance.SELF);
  const upgradeData = data.getUpgradeData(upgradeId);
  const { abilityId } = upgradeData; 
  if (abilityId === undefined) return [];
  
  const upgradeInProgress = upgraders.find(upgrader => upgrader.orders && upgrader.orders.find(order => order.abilityId === abilityId));
  if (upgradeInProgress) return [];
  
  let actionsToPerform = [];
  const gameState = GameState.getInstance();
  if (agent.canAffordUpgrade(upgradeId)) {
    const upgrader = getRandom(upgraders.filter(upgrader => {
      return upgrader.noQueue && upgrader.abilityAvailable(abilityId);
    }));
    if (upgrader) {
      const unitCommand = createUnitCommand(abilityId, [upgrader]);
      actionsToPerform.push(unitCommand);
      setPendingOrders(upgrader, unitCommand);
    } else {
      const techLabRequired = techLabTypes.some(techLabType => UnitAbilityMap[techLabType].some(ability => ability === abilityId));
      if (techLabRequired) {
        const techLabs = units.getAlive(Alliance.SELF).filter(unit => {
          // Ensure unitType is defined before using it
          return unit.unitType !== undefined && techLabTypes.includes(unit.unitType);
        });
        const orphanTechLabs = techLabs.filter(techLab => {
          const { pos } = techLab; if (pos === undefined) return false;
          const footprint = getFootprint(BARRACKS); if (footprint === undefined) return false;
          return techLab.unitType === TECHLAB && !pointsOverlap(cellsInFootprint(getAddOnBuildingPlacement(pos), footprint), landingGrids);
        });
        if (orphanTechLabs.length > 0) {
          // Retrieve barracks unit IDs from GameState
          const barracksTypeIds = gameState.countTypes.get(BARRACKS);

          // Filter only completed barracks
          /** @type {Unit[]} */
          let completedBarracks = [];
          if (barracksTypeIds !== undefined) {
            completedBarracks = units.getById(barracksTypeIds).filter(barracks => barracks.buildProgress !== undefined && barracks.buildProgress >= 1);
          }

          let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);

          // If no idle barracks, get closest barracks to tech lab that are either not training a unit or have orders with progress less than 0.5

          const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => {
            const firstOrder = barracks.orders && barracks.orders[0];
            return isTrainingUnit(data, barracks) && (firstOrder ? (firstOrder.progress !== undefined && firstOrder.progress <= 0.5) : true);
          });

          if (barracks.length > 0) {
            /** @type {{barracks: Unit | undefined, addOnPosition: Point2D | undefined}} */
            let closestPair = { barracks: undefined, addOnPosition: undefined };

            barracks.forEach(barracksUnit => {
              orphanTechLabs.forEach(techLab => {
                if (!techLab.pos) return false;

                const addOnBuildingPosition = BuildingPlacement.getAddOnBuildingPosition(techLab.pos);

                if (!closestPair.barracks || !closestPair.addOnPosition) {
                  closestPair = { barracks: barracksUnit, addOnPosition: addOnBuildingPosition };
                } else {
                  if (getDistance(barracksUnit.pos, addOnBuildingPosition) < getDistance(closestPair.barracks.pos, closestPair.addOnPosition)) {
                    closestPair = { barracks: barracksUnit, addOnPosition: addOnBuildingPosition };
                  }
                }
              });
            });
            if (closestPair.barracks && closestPair.addOnPosition) {
              // if barracks is training unit, cancel training.
              if (isTrainingUnit(data, closestPair.barracks)) {
                if (closestPair.barracks && closestPair.barracks.orders) {
                  for (let i = 0; i < closestPair.barracks.orders.length; i++) {
                    const cancelCommand = createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair.barracks]);
                    actionsToPerform.push(cancelCommand);
                    setPendingOrders(closestPair.barracks, cancelCommand);
                  }
                }
              }
              // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
              const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
              const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
              const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);

              // Here, handle the undefined movementSpeed
              const unitTypeData = data.getUnitTypeData(UnitType.BARRACKSFLYING);
              if (unitTypeData === undefined || unitTypeData.movementSpeed === undefined) {
                // If movementSpeed is undefined, return empty array or handle it appropriately
                return [];
              }

              const movementSpeedPerSecond = unitTypeData.movementSpeed * 1.4;
              const distance = getDistance(closestPair.barracks.pos, closestPair.addOnPosition);
              const timeToMove = distance / movementSpeedPerSecond + (liftAndLandingTime * 2);

              if (timeUntilUpgradeCanStart < timeToMove) {
                const label = 'reposition';
                closestPair.barracks.labels.set(label, closestPair.addOnPosition);
              }
            }
          }
        } else {

          const nonOrphanTechLabs = techLabs.filter(techLab => techLab.unitType !== TECHLAB);
          // find idle building with tech lab.
          const idleBuildingsWithTechLab = nonOrphanTechLabs
            .map(techLab => {
              // Check if techLab.pos is defined before proceeding
              if (!techLab.pos) return undefined;

              const addOnBuildingPosition = BuildingPlacement.getAddOnBuildingPosition(techLab.pos);
              // Ensure addOnBuildingPosition is defined before calling getClosest
              if (!addOnBuildingPosition) return undefined;

              return units.getClosest(addOnBuildingPosition, units.getAlive(Alliance.SELF), 1)[0];
            })
            .filter(building => building && building.noQueue && getPendingOrders(building).length === 0);

          // find closest barracks to closest tech lab.
          /** @type {Unit[]} */
          let closestPair = [];
          // Get the barracks type IDs from GameState, ensuring it's not undefined
          const barracksTypeIds = gameState.countTypes.get(BARRACKS);
          if (barracksTypeIds === undefined) {
            // Handle the undefined case, e.g., return an empty array or proceed with a default value
            return [];
          }

          // Now that we've ensured barracksTypeIds is defined, we can safely use it in units.getById
          let completedBarracks = units.getById(barracksTypeIds).filter(barracks =>
            barracks.buildProgress !== undefined && barracks.buildProgress >= 1
          );

          // Filter only those barracks that have no queue
          let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);
          // if no idle barracks, get closest barracks to tech lab.
          const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => {
            // Safely check the progress of the first order
            const firstOrderProgress = barracks.orders?.[0]?.progress ?? 1; // Default to 1 if undefined
            return isTrainingUnit(data, barracks) && firstOrderProgress <= 0.5;
          });
          if (barracks.length > 0 && idleBuildingsWithTechLab.length > 0) {
            barracks.forEach(barracksUnit => {
              idleBuildingsWithTechLab.forEach(idleBuildingWithTechLab => {
                if (!idleBuildingWithTechLab) return; // Skip if idleBuildingWithTechLab is undefined

                // Only proceed if both barracksUnit and idleBuildingWithTechLab have defined positions
                if (barracksUnit.pos && idleBuildingWithTechLab.pos) {
                  if (closestPair.length > 0) {
                    closestPair = getDistance(barracksUnit.pos, idleBuildingWithTechLab.pos) < getDistance(closestPair[0].pos, closestPair[1].pos) ?
                      [barracksUnit, idleBuildingWithTechLab] : closestPair;
                  } else {
                    closestPair = [barracksUnit, idleBuildingWithTechLab];
                  }
                }
              });
            });
          }
          if (closestPair.length > 0) {
            const { pos: pos0, orders: orders0 } = closestPair[0];
            if (pos0 === undefined || orders0 === undefined) return []; // Return an empty array
            const { pos: pos1 } = closestPair[1]; if (pos1 === undefined) return [];
            // if barracks is training unit, cancel training.
            // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
            const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
            const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
            const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);
            const distance = getDistance(pos1, pos0);
            if (distance > 0) {
              const { movementSpeed } = data.getUnitTypeData(UnitType.BARRACKSFLYING); if (movementSpeed === undefined) return [];
              const movementSpeedPerSecond = movementSpeed * 1.4;
              const timeToMove = distance / movementSpeedPerSecond + (64 / 22.4);
              if (timeUntilUpgradeCanStart < timeToMove) {
                // Check if the unit is training and has orders before iterating over them
                if (isTrainingUnit(data, closestPair[0]) && closestPair[0].orders) {
                  for (let i = 0; i < closestPair[0].orders.length; i++) {
                    const cancelCommand = createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair[0]]);
                    actionsToPerform.push(cancelCommand);
                    setPendingOrders(closestPair[0], cancelCommand);
                  }
                } else {
                  const label = 'reposition';
                  closestPair[0].labels.set(label, closestPair[1].pos);
                  closestPair[1].labels.set(label, 'lift');
                }
              }
            }
          }
        }
      }
    }
  } else {
    const techLabRequired = techLabTypes.some(techLabType => UnitAbilityMap[techLabType].some(ability => ability === abilityId));
    if (techLabRequired) {
      const techLabs = units.getAlive(Alliance.SELF).filter(unit => {
        // Check if unitType is defined before using it in the filter
        return unit.unitType !== undefined && techLabTypes.includes(unit.unitType);
      });
      const orphanTechLabs = techLabs.filter(techLab => {
        const { pos } = techLab; if (pos === undefined) return false;
        const footprint = getFootprint(BARRACKS); if (footprint === undefined) return false;
        return techLab.unitType === TECHLAB && !pointsOverlap(cellsInFootprint(getAddOnBuildingPlacement(pos), footprint), landingGrids);
      });
      if (orphanTechLabs.length > 0) {
        // get completed and idle barracks
        /** @type {Unit[]} */
        let completedBarracks = [];
        const barracksTypeIds = gameState.countTypes.get(UnitType.BARRACKS);
        if (barracksTypeIds) {
          completedBarracks = units.getById(barracksTypeIds).filter(barracks =>
            barracks.buildProgress !== undefined && barracks.buildProgress >= 1);
        }
        let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);

        // Filter barracks based on their training status and the progress of their first order
        const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => {
          // Safely check the progress of the first order, default to 1 if undefined
          const firstOrderProgress = barracks.orders?.[0]?.progress ?? 1;
          return isTrainingUnit(data, barracks) && firstOrderProgress <= 0.5;
        });

        if (barracks.length > 0) {
          // Initialize closestPair as an empty array of Unit
          /** @type {Unit[]} */
          let closestPair = [];

          // Initialize a variable to track the minimum distance
          let minDistance = Infinity;

          // Iterate over barracks and tech labs to find the closest pair
          barracks.forEach(barracksUnit => {
            orphanTechLabs.forEach(techLab => {
              // Ensure both positions are defined
              if (!barracksUnit.pos || !techLab.pos) return;

              const addOnBuildingPosition = BuildingPlacement.getAddOnBuildingPosition(techLab.pos);
              const distance = getDistance(barracksUnit.pos, addOnBuildingPosition);
              if (distance < minDistance) {
                minDistance = distance;
                closestPair = [barracksUnit, techLab]; // Only include Unit objects
              }
            });
          });

          if (closestPair.length > 0) {
            // Destructure the closest pair to extract the units
            const [barracksUnit, techLabUnit] = closestPair;

            // Ensure both units have defined positions
            if (!barracksUnit.pos || !techLabUnit.pos) return [];

            // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
            const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
            const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
            const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);

            const distance = getDistance(barracksUnit.pos, techLabUnit.pos);
            const movementSpeedData = data.getUnitTypeData(UnitType.BARRACKSFLYING);

            // Ensure movementSpeedData and its movementSpeed property are defined
            if (!movementSpeedData || movementSpeedData.movementSpeed === undefined) return [];

            const movementSpeedPerSecond = movementSpeedData.movementSpeed * 1.4;
            const timeToMove = distance / movementSpeedPerSecond + (liftAndLandingTime * 2);

            if (timeUntilUpgradeCanStart < timeToMove) {
              // Label the barracks for repositioning
              barracksUnit.labels.set('reposition', techLabUnit.pos);
              techLabUnit.labels.set('lift', true); // Indicate that the tech lab needs to lift
            }
          }
        }
      } else {
        const nonOrphanTechLabs = techLabs.filter(techLab => techLab.unitType !== TECHLAB);
        // find idle building with tech lab.
        const idleBuildingsWithTechLab = nonOrphanTechLabs
          .map(techLab => {
            // Check if techLab.pos is defined before proceeding
            if (!techLab.pos) {
              // Handle the undefined case (e.g., skip this iteration)
              return undefined;
            }

            // Now that techLab.pos is confirmed to be defined, use it in the function call
            const addOnBuildingPosition = BuildingPlacement.getAddOnBuildingPosition(techLab.pos);
            if (!addOnBuildingPosition) return undefined;
            // Proceed with the rest of your logic...
            return units.getClosest(addOnBuildingPosition, units.getAlive(Alliance.SELF), 1)[0];
          })
          .filter(building => building && building.noQueue && getPendingOrders(building).length === 0);
        // find closest barracks to closest tech lab.
        /** @type {Unit[]} */
        let closestPair = [];
        // get completed and idle barracks.
        /** @type {Unit[]} */
        let completedBarracks = [];
        const barracksTypeIds = gameState.countTypes.get(UnitType.BARRACKS);

        if (barracksTypeIds) {
          completedBarracks = units.getById(barracksTypeIds).filter(barracks =>
            barracks.buildProgress !== undefined && barracks.buildProgress >= 1
          );
        }
        let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);
        // if no idle barracks, get closest barracks to tech lab.
        const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => {
          // Check if 'orders' is defined before accessing its elements
          if (!barracks.orders || barracks.orders.length === 0) {
            return false; // Skip this barracks if it has no orders
          }

          // Safely access the first order's progress
          const firstOrderProgress = barracks.orders[0].progress;
          return isTrainingUnit(data, barracks) && (firstOrderProgress !== undefined && firstOrderProgress <= 0.5);
        });
        if (barracks.length > 0 && idleBuildingsWithTechLab.length > 0) {
          barracks.forEach(barracksUnit => {
            idleBuildingsWithTechLab.forEach(idleBuildingWithTechLab => {
              // Only proceed if both barracksUnit and idleBuildingWithTechLab are defined
              if (!barracksUnit || !idleBuildingWithTechLab) return;

              // Existing distance calculation logic...
              if (closestPair.length > 0) {
                closestPair = getDistance(barracksUnit.pos, idleBuildingWithTechLab.pos) < getDistance(closestPair[0].pos, closestPair[1].pos) ?
                  [barracksUnit, idleBuildingWithTechLab] : closestPair;
              } else {
                closestPair = [barracksUnit, idleBuildingWithTechLab];
              }
            });
          });
        }
        if (closestPair.length > 0) {
          const { pos: pos0, orders: orders0 } = closestPair[0];
          if (pos0 === undefined || orders0 === undefined) return [];
          const { pos: pos1 } = closestPair[1]; if (pos1 === undefined) return [];

          const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
          const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
          const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);
          const distance = getDistance(pos1, pos0);
          if (distance > 0) {
            const { movementSpeed } = data.getUnitTypeData(UnitType.BARRACKSFLYING); if (movementSpeed === undefined) return [];
            const movementSpeedPerSecond = movementSpeed * 1.4;
            const timeToMove = distance / movementSpeedPerSecond + (64 / 22.4);
            if (timeUntilUpgradeCanStart < timeToMove) {
              if (isTrainingUnit(data, closestPair[0]) && closestPair[0].orders) {
                for (let i = 0; i < closestPair[0].orders.length; i++) {
                  const cancelCommand = createUnitCommand(Ability.CANCEL_QUEUE5, [closestPair[0]]);
                  actionsToPerform.push(cancelCommand);
                  setPendingOrders(closestPair[0], cancelCommand);
                }
              } else {
                const label = 'reposition';
                closestPair[0].labels.set(label, closestPair[1].pos);
                closestPair[1].labels.set(label, 'lift');
              }
            }
          }
        }
      }
    }
  }
  addEarmark(data, upgradeData);

  return actionsToPerform;
}

module.exports = {
  unitProductionAvailable,
  buildSupplyOrTrain,
  getFoodDifference,
  getProductionUnits,
  haveAvailableProductionUnitsFor,
  manageZergSupply,
  refreshProductionUnitsCache,
  train,
  upgrade,
};