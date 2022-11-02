//@ts-check
"use strict"

const { WarpUnitAbility, UnitType, UnitTypeId, UpgradeId } = require("@node-sc2/core/constants");
const { Alliance, Attribute, Race } = require("@node-sc2/core/constants/enums");
const { addonTypes, techLabTypes } = require("@node-sc2/core/constants/groups");
const { GasMineRace, TownhallRace, WorkerRace } = require("@node-sc2/core/constants/race-map");
const { WARPGATE, TECHLAB, BARRACKS, GREATERSPIRE } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getAvailableExpansions, getNextSafeExpansion } = require("../../helper/expansions");
const { countTypes } = require("../../helper/groups");
const { getInTheMain } = require("../../helper/placement/placement-helper");
const { getAddOnBuildingPosition } = require("../../helper/placement/placement-utilities");
const { warpIn } = require("../../helper/protoss");
const { addAddOn } = require("../../helper/terran");
const worldService = require("../../services/world-service");
const planService = require("../../services/plan-service");
const { balanceResources } = require("../manage-resources");
const { checkUnitCount } = require("../track-units/track-units-service");
const unitTrainingService = require("../unit-training/unit-training-service");
const { checkBuildingCount, findAndPlaceBuilding, unpauseAndLog, premoveBuilderToPosition, canBuild, assignAndSendWorkerToBuild, getFoodUsed } = require("../../services/world-service");
const { addEarmark, isTrainingUnit } = require("../../services/data-service");
const getRandom = require("@node-sc2/core/utils/get-random");
const { createUnitCommand } = require("../../services/actions-service");
const { CANCEL_QUEUE5 } = require("@node-sc2/core/constants/ability");
const { setPendingOrders } = require("../unit-resource/unit-resource-service");

const planActions = {
  /**
   * 
   * @param {World} world 
   * @param {AbilityId} abilityId 
   * @returns {Promise<any[]>}
   */
  ability: async (world, abilityId) => {
    const collectedActions = [];
    const { data, resources } = world;
    const { units } = resources.get();
    let canDoTypes = data.findUnitTypesWithAbility(abilityId);
    if (canDoTypes.length === 0) {
      canDoTypes = units.getAlive(Alliance.SELF).map(selfUnits => selfUnits.unitType);
    }
    const unitsCanDo = units.getByType(canDoTypes).filter(unit => unit.alliance === Alliance.SELF);
    if (unitsCanDo.length > 0) {
      if (unitsCanDo.filter(unit => unit.abilityAvailable(abilityId)).length > 0) {
        let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
        const unitCommand = { abilityId, unitTags: [unitCanDo.tag] }
        collectedActions.push(unitCommand);
      } else {
        unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
    return collectedActions;
  },
  /**
   * 
   * @param {World} world 
   * @param {number} unitType 
   * @param {null | number} targetCount
   * @param {Point2D[]} candidatePositions
   * @param {boolean} stepAhead
   * @returns {Promise<void>}
   */
  build: async (world, unitType, targetCount = null, candidatePositions = [], stepAhead = false) => {
    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    const collectedActions = [];
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    if (checkBuildingCount(world, unitType, targetCount) || targetCount === null) {
      const { race } = agent;
      if (stepAhead) {
        addEarmark(data, data.getUnitTypeData(WorkerRace[race]));
      }
      switch (true) {
        case TownhallRace[race].includes(unitType):
          if (TownhallRace[race].indexOf(unitType) === 0) {
            if (units.getBases().length == 2 && agent.race === Race.TERRAN) {
              candidatePositions = await getInTheMain(resources, unitType);
              collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions, stepAhead));
            } else {
              const availableExpansions = getAvailableExpansions(resources);
              candidatePositions = availableExpansions.length > 0 ? [await getNextSafeExpansion(world, availableExpansions)] : [];
              collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions, stepAhead));
            }
          } else {
            if (!stepAhead) {
              collectedActions.push(...await morphStructureAction(world, unitType));
            }
          }
          break;
        case addonTypes.includes(unitType): {
          const abilityIds = worldService.getAbilityIdsForAddons(data, unitType);
          const canDoTypes = worldService.getUnitTypesWithAbilities(data, abilityIds);
          const canDoTypeUnits = units.getById(canDoTypes);
          const unitsCanDoWithoutAddOnAndIdle = getUnitsCanDoWithoutAddOnAndIdle(world, unitType);
          const unitsCanDoIdle = unitsCanDoWithoutAddOnAndIdle.length > 0 ? unitsCanDoWithoutAddOnAndIdle : getUnitsCanDoWithAddOnAndIdle(canDoTypeUnits);
          if (unitsCanDoIdle.length > 0) {
            let unitCanDo = unitsCanDoIdle[Math.floor(Math.random() * unitsCanDoIdle.length)];
            await addAddOn(world, unitCanDo, unitType, stepAhead);
          } else {
            const busyCanDoUnits = canDoTypeUnits.filter(unit => unit.addOnTag === '0').filter(unit => isTrainingUnit(data, unit));
            const randomBusyTrainingUnit = getRandom(busyCanDoUnits);
            if (randomBusyTrainingUnit === undefined || randomBusyTrainingUnit.orders === undefined) return;
            console.log(worldService.outpowered, randomBusyTrainingUnit.orders[0].progress);
            if (!worldService.outpowered && randomBusyTrainingUnit && randomBusyTrainingUnit.orders[0].progress <= 0.5) {
              await actions.sendAction(createUnitCommand(CANCEL_QUEUE5, [randomBusyTrainingUnit]));
            } else {
              const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
              await balanceResources(world, mineralCost / vespeneCost);
              if (targetCount !== null) {
                planService.pausePlan = true;
                planService.continueBuild = false;
              }
            }
          }
          break;
        }
        default:
          if (!stepAhead && unitType === GREATERSPIRE) {
            collectedActions.push(...await morphStructureAction(world, unitType));
          } else {
            collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions, stepAhead));
          }
      }
    }
    await actions.sendAction(collectedActions);
  },
  /**
 * @param {World} world
 * @param {number} unitType
 * @param {number} targetCount
 * @param {boolean} stepAhead
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
 */
  buildGasMine: async (world, unitType, targetCount, stepAhead) => {
    const { agent, data, resources } = world;
    const { actions, map } = resources.get();
    const collectedActions = [];
    try {
      if (map.freeGasGeysers().length > 0) {
        const [ geyser ] = map.freeGasGeysers();
        const { pos } = geyser;
        if (pos === undefined) return collectedActions;
        if (agent.canAfford(unitType) && !stepAhead) {
          await actions.sendAction(assignAndSendWorkerToBuild(world, unitType, pos));
          planService.pausePlan = false;
        } else {
          collectedActions.push(...premoveBuilderToPosition(world, pos, unitType, stepAhead));
          if (!stepAhead) {
            const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
            await balanceResources(world, mineralCost / vespeneCost);
            planService.pausePlan = true;
            planService.continueBuild = false;
          }
        }
      }
    } catch (error) {
      console.log(error);
      if (targetCount !== null) {
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitTypeId 
   * @param {number} targetCount 
   * @returns {Promise<void>}
   */
  train: async (world, unitTypeId, targetCount = null) => {
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    let unitTypeData = data.getUnitTypeData(unitTypeId);
    let { abilityId } = unitTypeData;
    if (checkUnitCount(world, unitTypeId, targetCount) || targetCount === null) {
      if (canBuild(world, unitTypeId)) {
        const trainer = getTrainer(world, unitTypeId);
        if (trainer) {
          const unitCommand = {
            abilityId,
            unitTags: [trainer.tag],
          }
          setPendingOrders(trainer, unitCommand);
          unpauseAndLog(world, UnitTypeId[unitTypeId]);
          await actions.sendAction([unitCommand]);
        } else {
          abilityId = WarpUnitAbility[unitTypeId]
          const warpGates = units.getById(WARPGATE).filter(warpgate => warpgate.abilityAvailable(abilityId));
          if (warpGates.length > 0) {
            unpauseAndLog(world, UnitTypeId[unitTypeId]);
            await warpIn(resources, this, unitTypeId);
          } else {
            if (targetCount !== null) {
              planService.pausePlan = true;
            }
            return;
          }
        }
        addEarmark(data, data.getUnitTypeData(unitTypeId));
        console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitTypeId)}`);
        unitTrainingService.selectedTypeToBuild = null;
      } else {
        if (!agent.canAfford(unitTypeId)) {
          console.log(`${agent.foodUsed}: Cannot afford ${Object.keys(UnitType).find(type => UnitType[type] === unitTypeId)}`, planService.isPlanPaused);
          const { mineralCost, vespeneCost } = data.getUnitTypeData(unitTypeId);
          await balanceResources(world, mineralCost / vespeneCost);
        }
        if (targetCount !== null) {
          planService.pausePlan = true;
          planService.continueBuild = false;
        }
      }
    }
  },
  /**
   * @param {World} world 
   * @param {number} upgradeId 
   */
  upgrade: async (world, upgradeId) => {
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    const upgraders = units.getUpgradeFacilities(upgradeId).filter(upgrader => upgrader.alliance === Alliance.SELF);
    if (upgraders.length > 0) {
      const upgradeData = data.getUpgradeData(upgradeId)
      const { abilityId } = upgradeData;
      const foundUpgradeInProgress = upgraders.find(upgrader => upgrader.orders.find(order => order.abilityId === abilityId));
      if (!agent.upgradeIds.includes(upgradeId) && foundUpgradeInProgress === undefined) {
        const upgrader = upgraders.find(unit => unit.noQueue && unit.abilityAvailable(abilityId));
        if (upgrader) {
          const unitCommand = { abilityId, unitTags: [upgrader.tag] };
          await actions.sendAction([unitCommand]);
          unpauseAndLog(world, UpgradeId[upgradeId]);
          addEarmark(data, upgradeData);
        } else {
          const { mineralCost, vespeneCost } = data.getUpgradeData(upgradeId);
          await balanceResources(world, mineralCost / vespeneCost);
          planService.pausePlan = true;
          planService.continueBuild = false;
        }
      }
    } else {
      // find techlabs
      const techLabs = units.getAlive(Alliance.SELF).filter(unit => techLabTypes.includes(unit.unitType));
      const orphanTechLabs = techLabs.filter(techLab => techLab.unitType === TECHLAB);
      if (orphanTechLabs.length > 0) {
        // get completed and idle barracks
        let completedBarracks = units.getById(countTypes.get(BARRACKS)).filter(barracks => barracks.buildProgress >= 1);
        let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);
        // if no idle barracks, get closest barracks to tech lab.
        const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => isTrainingUnit(data, barracks) && barracks.orders[0].progress <= 0.5);
        if (barracks.length > 0) {
          let closestPair = [];
          barracks.forEach(barracks => {
            orphanTechLabs.forEach(techLab => {
              const addOnBuildingPosition = getAddOnBuildingPosition(techLab.pos);
              if (closestPair.length > 0) {
                closestPair = distance(barracks.pos, addOnBuildingPosition) < distance(closestPair[0].pos, closestPair[1]) ? [barracks, addOnBuildingPosition] : closestPair;
              } else { closestPair = [barracks, addOnBuildingPosition]; }
            });
          });
          if (closestPair.length > 0) {
            // if barracks is training unit, cancel training.
            if (isTrainingUnit(data, closestPair[0])) {
              // for each training unit, cancel training.
              for (let i = 0; i < closestPair[0].orders.length; i++) {
                await actions.sendAction(createUnitCommand(CANCEL_QUEUE5, [closestPair[0]]));
              }
            }
            const label = 'reposition';
            closestPair[0].labels.set(label, closestPair[1]);
          }
        }
      } else {
        const nonOrphanTechLabs = techLabs.filter(techLab => techLab.unitType !== TECHLAB);
        // find idle building with tech lab.
        const idleBuildingsWithTechLab = nonOrphanTechLabs.map(techLab => units.getClosest(getAddOnBuildingPosition(techLab.pos), units.getAlive(Alliance.SELF), 1)[0]).filter(building => building.noQueue);
        // find closest barracks to closest tech lab.
        let closestPair = [];
        // get completed and idle barracks.
        let completedBarracks = units.getById(countTypes.get(BARRACKS)).filter(barracks => barracks.buildProgress >= 1);
        let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);
        // if no idle barracks, get closest barracks to tech lab.
        const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => isTrainingUnit(data, barracks) && barracks.orders[0].progress <= 0.5);
        if (barracks.length > 0) {
          barracks.forEach(barracks => {
            idleBuildingsWithTechLab.forEach(idleBuildingsWithtechLab => {
              if (closestPair.length > 0) {
                closestPair = distance(barracks.pos, idleBuildingsWithtechLab.pos) < distance(closestPair[0].pos, closestPair[1].pos) ? [barracks, idleBuildingsWithtechLab] : closestPair;
              } else { closestPair = [barracks, idleBuildingsWithtechLab]; }
            });
          });
        }
        if (closestPair.length > 0) {
          // if barracks is training unit, cancel training.
          if (isTrainingUnit(data, closestPair[0])) {
            for (let i = 0; i < closestPair[0].orders.length; i++) {
              await actions.sendAction(createUnitCommand(CANCEL_QUEUE5, [closestPair[0]]));
            }
          } else {
            const label = 'swapBuilding';
            closestPair[0].labels.set(label, closestPair[1].pos);
            closestPair[1].labels.set(label, closestPair[0].pos);
          }
        }
        // //
        // const nonOrphanAddOn = addOns.filter(addOn => addOn.unitType !== TECHLAB || addOn.unitType !== REACTOR);
        // // find idle building with tech lab.
        // const idleBuildingsWithAddOn = nonOrphanAddOn.map(techLab => units.getClosest(getAddOnBuildingPosition(techLab.pos), units.getAlive(Alliance.SELF), 1)[0]).filter(building => building.noQueue);;
        // // find closest barracks to closest tech lab.
        // let closestPair = [];
        // // get nonaddOn buildingsType of addOnType.
        // const nonAddOnBuildingType = getKeyByMapValue(addOnTypesMapping, upgradeTypeForUpgrade);
        // units.getById(countTypes.get(nonAddOnBuildingType)).forEach(building => {
        //   if (building.buildProgress >= 1 && building.noQueue) {
        //     idleBuildingsWithAddOn.forEach(addOn => {
        //       if (closestPair.length > 0) {
        //         closestPair = distance(building.pos, addOn.pos) < distance(closestPair[0].pos, closestPair[1].pos) ? [building, addOn] : closestPair;
        //       } else { closestPair = [building, addOn]; }
        //     });
        //   }
        // });
        // if (closestPair.length > 0) {
        //   const label = 'swapBuilding';
        //   closestPair[0].labels.set(label, closestPair[1].pos);
        //   closestPair[1].labels.set(label, closestPair[0].pos);
        // }
      }
    }
  },
  /**
 * @param {World} world 
 */
  runPlan: async (world) => {
    const { agent, data } = world;
    planService.continueBuild = true;
    planService.pausedThisRound = false;
    const { plan } = planService;
    for (let step = 0; step < plan.length; step++) {
      if (planService.continueBuild) {
        planService.currentStep = step;
        const planStep = plan[step];
        const { food, orderType, unitType } = planStep;
        if (unitType === undefined || unitType === null ) break;
        const { attributes } = data.getUnitTypeData(unitType);
        if (attributes === undefined) break;
        const { candidatePositions, targetCount } = planStep;
        if (getFoodUsed(world) + 1 >= food) {
          const stepAhead = getFoodUsed(world) + 1 === food;
          if (orderType === 'UnitType') {
            if (attributes.includes(Attribute.STRUCTURE)) {
              await planActions.build(world, unitType, targetCount, candidatePositions, stepAhead);
            } else {
              if (stepAhead) break;
              await planActions.train(world, unitType, targetCount);
            }
          } else if (orderType === 'Upgrade') {
            if (stepAhead) break;
            await planActions.upgrade(world, planStep.upgrade);
          }
        } else {
          let { minerals } = agent;
          if (minerals === undefined) break;
          minerals = minerals - data.getEarmarkTotals('').minerals;
          if (minerals > planService.mineralThreshold) {
            if (attributes.includes(Attribute.STRUCTURE)) {
              await planActions.build(world, unitType, targetCount, planStep.candidatePositions, false);
            }
            break;
          }
        }
      } else {
        break;
      }
    }
    if (!planService.pausedThisRound) {
      planService.pausePlan = false;
    }
  },
}
// /**
//  * @param {DataStorage} data
//  * @param {number} upgradeId
//  * @returns {number[]}
//  */
// function getUnitTypesForUpgrade(data, upgradeId) {
//   const { abilityId } = data.getUpgradeData(upgradeId)
//   const upgradeUnitTypes = [
//     ...data.findUnitTypesWithAbility(abilityId),
//     ...data.findUnitTypesWithAbility(data.getAbilityData(abilityId).remapsToAbilityId),
//   ];
//   return upgradeUnitTypes;
// }
// /**
//  * @param {Map} map
//  * @param {any} searchValue
//  */
// function getKeyByMapValue(map, searchValue) {
//   for (const [key, value] of map.entries()) {
//     if (value === searchValue) {
//       return key;
//     }
//   }
// }
module.exports = planActions;

/**
 * @param {Unit[]} canDoTypeUnits
 * @returns {Unit[]}
 */
function getUnitsCanDoWithAddOnAndIdle(canDoTypeUnits) {
  if (canDoTypeUnits.every(unit => unit.buildProgress && (unit.buildProgress >= 1 || unit.buildProgress < 0.5))) {
    return canDoTypeUnits.filter(unit => (unit.hasReactor() || unit.hasTechLab()) && unit.isIdle());
  } else {
    return [];
  }
}

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType 
 * @returns {Unit[]}
 */
function getUnitsCanDoWithoutAddOnAndIdle(world, unitType) {
  const { data, resources } = world;
  const { units } = resources.get();
  const abilityIds = worldService.getAbilityIdsForAddons(data, unitType);
  const canDoTypes = worldService.getUnitTypesWithAbilities(data, abilityIds);
  const canDoTypeUnits = units.getById(canDoTypes);
  const addOnUnits = units.withLabel('addAddOn');
  const availableAddOnUnits = addOnUnits.filter(unit => abilityIds.some(abilityId => unit.abilityAvailable(abilityId)));
  const availableCanDoTypeUnits = canDoTypeUnits.filter(unit => abilityIds.some(abilityId => unit.abilityAvailable(abilityId) && !unit.labels.has('reposition')));
  return availableAddOnUnits.length > 0 ? availableAddOnUnits : availableCanDoTypeUnits;
}

/**
 * @param {World} world 
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
 */
async function morphStructureAction(world, unitType) {
  const { data } = world;
  const collectedActions = [];
  const actions = await planActions.ability(world, data.getUnitTypeData(unitType).abilityId);
  if (actions.length > 0) {
    unpauseAndLog(world, UnitTypeId[unitType]);
    addEarmark(data, data.getUnitTypeData(unitType));
    collectedActions.push(...actions);
  }
  return collectedActions;
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitTypeId
 * @returns {Unit | undefined}
 */
function getTrainer(world, unitTypeId) {
  const { data, resources } = world;
  const { units } = resources.get();
  let unitTypeData = data.getUnitTypeData(unitTypeId);
  let { abilityId } = unitTypeData;
  return units.getProductionUnits(unitTypeId).find(unit => {
    const { orders } = unit;
    if (abilityId === undefined || orders === undefined) return false;
    const spaceToTrain = unit.isIdle() || (unit.hasReactor() && orders.length < 2);
    return spaceToTrain && unit.abilityAvailable(abilityId) && !unit.labels.has('reposition')
  });
}