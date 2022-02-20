//@ts-check
"use strict"

const { WarpUnitAbility, UnitType, UnitTypeId, UpgradeId } = require("@node-sc2/core/constants");
const { Alliance, Attribute } = require("@node-sc2/core/constants/enums");
const { addonTypes, techLabTypes } = require("@node-sc2/core/constants/groups");
const { GasMineRace, TownhallRace } = require("@node-sc2/core/constants/race-map");
const { WARPGATE, TECHLAB, BARRACKS } = require("@node-sc2/core/constants/unit-type");
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
const { checkBuildingCount, findAndPlaceBuilding, unpauseAndLog, premoveBuilderToPosition, canBuild, assignAndSendWorkerToBuild, setAndLogExecutedSteps } = require("../../services/world-service");
const { addEarmark, isTrainingUnit } = require("../../services/data-service");
const getRandom = require("@node-sc2/core/utils/get-random");
const { createUnitCommand } = require("../../services/actions-service");
const { CANCEL_QUEUE5 } = require("@node-sc2/core/constants/ability");
const { getStringNameOfConstant } = require("../../services/logging-service");

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
   * @returns {Promise<void>}
   */
  build: async (world, unitType, targetCount = null, candidatePositions = []) => {
    const collectedActions = [];
    const { agent, data, resources } = world;
    const { actions, frame, map, units } = resources.get();
    if (checkBuildingCount(world, unitType, targetCount) || targetCount === null) {
      const { race } = world.agent;
      switch (true) {
        case GasMineRace[race] === unitType:
          try {
            if (map.freeGasGeysers().length > 0) {
              const [geyser] = map.freeGasGeysers();
              if (agent.canAfford(unitType)) {
                await actions.sendAction(assignAndSendWorkerToBuild(world, unitType, geyser.pos));
                planService.pausePlan = false;
                setAndLogExecutedSteps(world, frame.timeInSeconds(), getStringNameOfConstant(UnitType, unitType));
              } else {
                collectedActions.push(...premoveBuilderToPosition(world, geyser.pos, unitType));
                const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
                await balanceResources(world, mineralCost / vespeneCost);
                planService.pausePlan = true;
                planService.continueBuild = false;
              }
            }
          } catch (error) {
            console.log(error);
            if (targetCount !== null) {
              planService.pausePlan = true;
              planService.continueBuild = false;
            }
          }
          break;
        case TownhallRace[race].includes(unitType):
          if (TownhallRace[race].indexOf(unitType) === 0) {
            if (units.getBases().length !== 2) {
              const availableExpansions = getAvailableExpansions(resources);
              candidatePositions = availableExpansions.length > 0 ? [await getNextSafeExpansion(world, availableExpansions)] : [];
              collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions));
            } else {
              candidatePositions = await getInTheMain(resources, unitType);
              collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions));
            }
          } else {
            const actions = await planActions.ability(world, data.getUnitTypeData(unitType).abilityId);
            if (actions.length > 0) {
              unpauseAndLog(world, UnitTypeId[unitType]);
              addEarmark(data, data.getUnitTypeData(unitType));
              collectedActions.push(...actions);
            }
          }
          break;
        case addonTypes.includes(unitType): {
          const abilityIds = worldService.getAbilityIdsForAddons(data, unitType);
          const canDoTypes = worldService.getUnitTypesWithAbilities(data, abilityIds);
          const canDoTypeUnits = units.getById(canDoTypes);
          const addOnUnits = units.withLabel('addAddOn');
          const unitsCanDoWithoutAddOnAndIdle = addOnUnits.filter(unit => abilityIds.some(abilityId => unit.abilityAvailable(abilityId))).length > 0 ? addOnUnits : canDoTypeUnits.filter(unit => abilityIds.some(abilityId => unit.abilityAvailable(abilityId)));
          const unitsCanDoIdle = unitsCanDoWithoutAddOnAndIdle.length > 0 ? unitsCanDoWithoutAddOnAndIdle : getUnitsCanDoWithAddOnAndIdle(canDoTypeUnits);
          if (unitsCanDoIdle.length > 0) {
            let unitCanDo = unitsCanDoIdle[Math.floor(Math.random() * unitsCanDoIdle.length)];
            await addAddOn(world, unitCanDo, unitType)
          } else {
            const busyCanDoUnits = canDoTypeUnits.filter(unit => unit.addOnTag === '0').filter(unit => isTrainingUnit(data, unit));
            const randomBusyTrainingUnit = getRandom(busyCanDoUnits);
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
          collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions));
      }
    }
    await actions.sendAction(collectedActions);
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitType 
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
        const trainer = units.getProductionUnits(unitTypeId).find(unit => (unit.noQueue || (unit.hasReactor() && unit.orders.length < 2)) && unit.abilityAvailable(abilityId));
        if (trainer) {
          const unitCommand = {
            abilityId,
            unitTags: [trainer.tag],
          }
          await actions.sendAction([unitCommand]);
        } else {
          abilityId = WarpUnitAbility[unitTypeId]
          const warpGates = units.getById(WARPGATE).filter(warpgate => warpgate.abilityAvailable(abilityId));
          if (warpGates.length > 0) {
            await warpIn(resources, this, unitTypeId);
          } else {
            if (targetCount !== null) {
              planService.pausePlan = true;
            }
            return;
          }
        }
        unpauseAndLog(world, UnitTypeId[unitTypeId]);
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
            } else {
              const label = 'reposition';
              closestPair[0].labels.set(label, closestPair[1]);
            }
          }
        }
      } else {
        const nonOrphanTechLabs = techLabs.filter(techLab => techLab.unitType !== TECHLAB);
        // find idle building with tech lab.
        const idleBuildingsWithTechLab = nonOrphanTechLabs.map(techLab => units.getClosest(getAddOnBuildingPosition(techLab.pos), units.getAlive(Alliance.SELF), 1)[0]).filter(building => building.noQueue);;
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
      }
    }
  },
  /**
 * @param {World} world 
 */
  runPlan: async (world) => {
    planService.continueBuild = true;
    planService.pausedThisRound = false;
    const { plan } = planService;
    for (let step = 0; step < plan.length; step++) {
      if (planService.continueBuild) {
        planService.currentStep = step;
        const planStep = plan[step];
        const { food, orderType, unitType } = planStep;
        if (world.agent.foodUsed >= food) {
          if (orderType === 'UnitType') {
            const { candidatePositions, targetCount } = planStep;
            if (world.data.getUnitTypeData(unitType).attributes.includes(Attribute.STRUCTURE)) {
              await planActions.build(world, unitType, targetCount, candidatePositions);
            } else {
              await planActions.train(world, unitType, targetCount);
            }
          } else if (orderType === 'Upgrade') {
            await planActions.upgrade(world, planStep.upgrade);
          }
        } else { break; }
      } else {
        break;
      }
    }
    if (!planService.pausedThisRound) {
      planService.pausePlan = false;
    }
  },
}

/**
 * @param {Unit[]} canDoTypeUnits
 * @returns {Unit[]}
 */
function getUnitsCanDoWithAddOnAndIdle(canDoTypeUnits) {
  return canDoTypeUnits.every(unit => unit.buildProgress >= 1 || unit.buildProgress < 0.5) ? canDoTypeUnits.filter(unit => unit.addOnTag !== '0' && unit.isIdle()) : [];
}
module.exports = planActions;