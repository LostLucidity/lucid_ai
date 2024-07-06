//@ts-check
"use strict";

// External library imports
const { UnitType, Ability } = require("@node-sc2/core/constants");
const { Alliance, Race } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");
const { SupplyUnitRace } = require("@node-sc2/core/constants/race-map");
const UnitAbilityMap = require("@node-sc2/core/constants/unit-ability-map");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const getRandom = require("@node-sc2/core/utils/get-random");

// Internal dependencies
const { handleUnitTraining } = require("./training");
const { liftAndLandingTime } = require("./unitConfig");
const { setPendingOrders } = require("./unitOrders");
const { EarmarkManager } = require("../../core");
const BuildingPlacement = require("../../features/construction/buildingPlacement");
const { buildSupply, getTimeToTargetCost } = require("../../features/construction/buildingService");
const { getTimeToTargetTech } = require("../../features/misc/gameData");
const { pointsOverlap, getAddOnBuildingPlacement, landingGrids } = require("../../features/shared/pathfinding");
const { getDistance } = require("../../features/shared/spatialCoreUtils");
const { GameState } = require('../../gameState');
const { getPendingOrders } = require("../../sharedServices");
const { createUnitCommand } = require("../../utils/common");
const { productionUnitsCache } = require("../../utils/unitUtils");

/**
 * Build supply or train units based on the game world state and strategy step.
 * @param {World} world
 * @param {import("../../features/strategy/strategyManager").PlanStep} step
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function buildSupplyOrTrain(world, step) {
  let collectedActions = [];

  collectedActions.push(...handleSupplyBuilding(world));
  collectedActions.push(...handleUnitTraining(world, step));
  updateFoodUsed(world);

  return collectedActions;
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
 * Handles the building of supply units.
 * @param {World} world
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function handleSupplyBuilding(world) {
  const { agent, data, resources } = world;

  // Ensure race is defined and has a corresponding supply unit type.
  if (typeof agent.race === 'undefined' || !SupplyUnitRace[agent.race]) {
    console.error("Race is undefined or does not have a supply unit type.");
    return [];
  }

  const supplyUnitId = SupplyUnitRace[agent.race];

  const supplyUnitData = data.getUnitTypeData(supplyUnitId);
  if (!supplyUnitData?.abilityId) {
    console.error("Build ability ID is undefined for the supply unit.");
    return [];
  }

  const units = resources.get().units;
  const pendingSupply = (
    units.inProgress(supplyUnitId).length + units.withCurrentOrders(supplyUnitData.abilityId).length
  ) * (supplyUnitData.foodProvided || 0);

  const totalExpectedFoodCap = (agent.foodCap || 0) + pendingSupply;

  // Calculate the current food demand, including earmarked food, with a default of 0 if undefined
  const currentFoodDemand = (agent.foodUsed || 0) + EarmarkManager.getEarmarkedFood();

  if (currentFoodDemand > totalExpectedFoodCap) {
    return agent.race === Race.ZERG ? manageZergSupply(world) : buildSupply(world);
  }

  return [];
}

/**
 * Checks if a unit is currently training another unit.
 * @param {DataStorage} data
 * @param {Unit} unit 
 * @returns {boolean}
 */
const isTrainingUnit = (data, unit) => {
  // Return false if unit.orders is undefined
  if (!unit.orders) {
    return false;
  }

  /** @type {{ [key: string]: number }} */
  const castedUnitType = /** @type {*} */ (UnitType);

  return unit.orders.some(order => {
    return Object.keys(castedUnitType).some(key => order.abilityId === data.getUnitTypeData(castedUnitType[key]).abilityId);
  });
};

/**
 * Manages Zerg supply by training Overlords as needed.
 * @param {World} world - The current game world context.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - Commands to train Overlords, if needed.
 */
function manageZergSupply(world) {
  const { agent, data, resources } = world;

  // Early exit if food capacity is sufficient or Overlords are unaffordable
  // Use nullish coalescing operator (??) to provide a default value of 0
  if (((agent.foodCap ?? 0) - (agent.foodUsed ?? 0) >= 8) || !agent.canAfford(UnitType.OVERLORD)) return [];

  const overlordAbilityId = data.getUnitTypeData(UnitType.OVERLORD)?.abilityId;
  if (!overlordAbilityId) return []; // Exit if Overlord data or ability ID is unavailable

  // Filter for idle Larvae and map them to Overlord training commands
  return resources.get().units.getById(UnitType.LARVA)
    .filter(larva => larva.isIdle() && larva.abilityAvailable(overlordAbilityId))
    .map(larva => createUnitCommand(overlordAbilityId, [larva]));
}

/**
 * Clears the production units cache.
 */
function refreshProductionUnitsCache() {
  productionUnitsCache.clear();
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
  EarmarkManager.getInstance().addEarmark(data, upgradeData);

  return actionsToPerform;
}

module.exports = {
  buildSupplyOrTrain,
  getProductionUnits,
  manageZergSupply,
  refreshProductionUnitsCache,
  upgrade,
};