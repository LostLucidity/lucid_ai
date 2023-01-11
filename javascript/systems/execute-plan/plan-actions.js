//@ts-check
"use strict"

const { UnitTypeId, UpgradeId } = require("@node-sc2/core/constants");
const { Alliance, Attribute, Race } = require("@node-sc2/core/constants/enums");
const { addonTypes, techLabTypes } = require("@node-sc2/core/constants/groups");
const { TownhallRace, WorkerRace } = require("@node-sc2/core/constants/race-map");
const { TECHLAB, BARRACKS, GREATERSPIRE } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getAvailableExpansions, getNextSafeExpansion } = require("../../helper/expansions");
const { countTypes, flyingTypesMapping } = require("../../helper/groups");
const { getInTheMain } = require("../../helper/placement/placement-helper");
const { getAddOnBuildingPosition } = require("../../helper/placement/placement-utilities");
const { addAddOn } = require("../../helper/terran");
const worldService = require("../../services/world-service");
const planService = require("../../services/plan-service");
const { balanceResources } = require("../manage-resources");
const { checkBuildingCount, findAndPlaceBuilding, unpauseAndLog, premoveBuilderToPosition, assignAndSendWorkerToBuild, getFoodUsed, trainWorkersOrCombatUnits, train, setAndLogExecutedSteps } = require("../../services/world-service");
const { addEarmark, isTrainingUnit, hasEarmarks } = require("../../services/data-service");
const getRandom = require("@node-sc2/core/utils/get-random");
const { createUnitCommand } = require("../../services/actions-service");
const { CANCEL_QUEUE5 } = require("@node-sc2/core/constants/ability");
const dataService = require("../../services/data-service");

const planActions = {
  /**
   * @param {World} world 
   * @param {AbilityId} abilityId 
   * @returns {Promise<any[]>}
   */
  ability: async (world, abilityId) => {
    const collectedActions = [];
    const { data, resources } = world;
    const { units } = resources.get();
    let canDoTypes = data.findUnitTypesWithAbility(abilityId).reduce((/** @type {UnitTypeId[]} */acc, unitTypeId) => {
      acc.push(unitTypeId);
      const key = [...flyingTypesMapping.keys()].find(key => flyingTypesMapping.get(key) === unitTypeId);
      if (key) acc.push(key);
      return acc;
    }, []);
    if (canDoTypes.length === 0) {
      canDoTypes = units.getAlive(Alliance.SELF).map(selfUnits => selfUnits.unitType);
    }
    const unitsCanDo = units.getById(canDoTypes);
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
        addEarmark(world, data.getUnitTypeData(WorkerRace[race]));
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
          if (!stepAhead) {
            const abilityIds = worldService.getAbilityIdsForAddons(data, unitType);
            const canDoTypes = worldService.getUnitTypesWithAbilities(data, abilityIds);
            const canDoTypeUnits = units.getById(canDoTypes);
            const unitsCanDoWithoutAddOnAndIdle = getUnitsCanDoWithoutAddOnAndIdle(world, unitType);
            const unitsCanDoIdle = unitsCanDoWithoutAddOnAndIdle.length > 0 ? unitsCanDoWithoutAddOnAndIdle : getUnitsCanDoWithAddOnAndIdle(canDoTypeUnits);
            addEarmark(world, data.getUnitTypeData(unitType));
            if (unitsCanDoIdle.length > 0) {
              let unitCanDo = unitsCanDoIdle[Math.floor(Math.random() * unitsCanDoIdle.length)];
              await addAddOn(world, unitCanDo, unitType, stepAhead);
            } else {
              const busyCanDoUnits = canDoTypeUnits.filter(unit => unit.addOnTag === '0').filter(unit => isTrainingUnit(data, unit));
              const randomBusyTrainingUnit = getRandom(busyCanDoUnits); if (randomBusyTrainingUnit === undefined || randomBusyTrainingUnit.orders === undefined) return;
              const { orders } = randomBusyTrainingUnit;
              const { progress } = orders[0]; if (progress === undefined) return;
              if (!worldService.outpowered && progress <= 0.5) {
                await actions.sendAction(createUnitCommand(CANCEL_QUEUE5, [randomBusyTrainingUnit]));
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
    const { agent, resources } = world;
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
   * @param {number} upgradeId 
   */
  upgrade: async (world, upgradeId) => {
    const { agent, data, resources } = world;
    const { upgradeIds } = agent; if (upgradeIds === undefined) return;
    const { actions, frame, units } = resources.get();
    const upgradeResearched = upgradeIds.includes(upgradeId);
    const upgraders = units.getUpgradeFacilities(upgradeId).filter(upgrader => upgrader.alliance === Alliance.SELF);
    const upgradeInProgress = upgraders.find(upgrader => upgrader.orders && upgrader.orders.find(order => order.abilityId === data.getUpgradeData(upgradeId).abilityId));
    if (upgradeResearched || upgradeInProgress) return;
    addEarmark(world, data.getUpgradeData(upgradeId));
    const upgrader = getRandom(upgraders.filter(upgrader => {
      const { abilityId } = data.getUpgradeData(upgradeId); if (abilityId === undefined) return;
      return upgrader.noQueue && upgrader.abilityAvailable(abilityId);
    }));
    if (upgrader) {
      const { abilityId } = data.getUpgradeData(upgradeId); if (abilityId === undefined) return;
      const unitCommand = createUnitCommand(abilityId, [upgrader]);
      await actions.sendAction([unitCommand]);
      setAndLogExecutedSteps(world, frame.timeInSeconds(), UpgradeId[upgradeId]);
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
        /** @type {Unit[]} */
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
            // if barracks is not training unit, move barracks to tech lab.
            const label = 'reposition';
            closestPair[0].labels.set(label, closestPair[1].pos);
            closestPair[1].labels.set(label, 'lift');
          }
        }
      }
    }
  },
  /**
 * @param {World} world 
 */
  runPlan: async (world) => {
    const { agent, data } = world;
    const { minerals, vespene } = agent; if (minerals === undefined || vespene === undefined) return;
    planService.continueBuild = true;
    dataService.earmarks = [];
    planService.pausedThisRound = false;
    planService.pendingFood = 0;
    const { plan } = planService;
    for (let step = 0; step < plan.length; step++) {
      if (planService.continueBuild) {
        planService.currentStep = step;
        const planStep = plan[step];
        await trainWorkersOrCombatUnits(world, planStep);
        let setEarmark = !hasEarmarks(data);
        const { candidatePositions, food, orderType, unitType, targetCount, upgrade } = planStep;
        const foodUsedOrGreater = getFoodUsed(world) + 1 >= food;
        let stepAhead = getFoodUsed(world) + 1 === food;
        if (orderType === 'UnitType') {
          if (unitType === undefined || unitType === null) break;
          const { attributes } = data.getUnitTypeData(unitType); if (attributes === undefined) break;
          const isStructure = attributes.includes(Attribute.STRUCTURE);
          let { minerals } = agent; if (minerals === undefined) break;
          const greaterThanMineralThreshold = minerals > planService.mineralThreshold;
          if (foodUsedOrGreater && !isStructure) {
            if (stepAhead) break;
            await train(world, unitType, targetCount);
          } else if (isStructure) {
            const spendAhead = !foodUsedOrGreater && greaterThanMineralThreshold
            stepAhead = spendAhead ? false : stepAhead;
            if (foodUsedOrGreater || spendAhead) {
              await planActions.build(world, unitType, targetCount, candidatePositions, stepAhead);
              if (spendAhead) break;
            }
          }
        } else if (foodUsedOrGreater && orderType === 'Upgrade' && !stepAhead) {
          if (upgrade === undefined || upgrade === null) break;
          await planActions.upgrade(world, upgrade);
        }
        if (setEarmark && hasEarmarks(data)) {
          const earmarkTotals = data.getEarmarkTotals('');
          const { minerals: mineralsEarmarked, vespene: vespeneEarmarked } = earmarkTotals;
          const mineralsNeeded = mineralsEarmarked - minerals > 0 ? mineralsEarmarked - minerals : 0;
          const vespeneNeeded = vespeneEarmarked - vespene > 0 ? vespeneEarmarked - vespene : 0;
          balanceResources(world, mineralsNeeded / vespeneNeeded);
        }
        const nextStep = plan[step + 1];
        if (nextStep) {
          await trainWorkersOrCombatUnits(world, nextStep);
        }
      } else {
        break;
      }
    }
    if (!hasEarmarks(data)) {
      addEarmark(world, data.getUnitTypeData(WorkerRace[agent.race]));
      const earmarkTotals = data.getEarmarkTotals('');
      const { minerals: mineralsEarmarked, vespene: vespeneEarmarked } = earmarkTotals;
      const mineralsNeeded = mineralsEarmarked - minerals > 0 ? mineralsEarmarked - minerals : 0;
      const vespeneNeeded = vespeneEarmarked - vespene > 0 ? vespeneEarmarked - vespene : 0;
      balanceResources(world, mineralsNeeded / vespeneNeeded);
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
  return canDoTypeUnits.filter(unit => (unit.hasReactor() || unit.hasTechLab()) && unit.isIdle());
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
    addEarmark(world, data.getUnitTypeData(unitType));
    collectedActions.push(...actions);
  }
  return collectedActions;
}
