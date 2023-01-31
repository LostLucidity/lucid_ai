//@ts-check
"use strict"

const { UpgradeId } = require("@node-sc2/core/constants");
const { Alliance, Attribute } = require("@node-sc2/core/constants/enums");
const { techLabTypes } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { TECHLAB, BARRACKS } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { countTypes } = require("../../helper/groups");
const { getAddOnBuildingPosition } = require("../../helper/placement/placement-utilities");
const planService = require("../../services/plan-service");
const { balanceResources } = require("../manage-resources");
const { premoveBuilderToPosition, assignAndSendWorkerToBuild, train, setAndLogExecutedSteps, setFoodUsed, builderSupplyOrTrain, build } = require("../../services/world-service");
const { addEarmark, isTrainingUnit, hasEarmarks } = require("../../services/data-service");
const getRandom = require("@node-sc2/core/utils/get-random");
const { createUnitCommand } = require("../../services/actions-service");
const { CANCEL_QUEUE5 } = require("@node-sc2/core/constants/ability");
const dataService = require("../../services/data-service");
const { getPendingOrders } = require("../../services/unit-service");

const planActions = {
  /**
   * @param {World} world
   * @param {number} unitType
   * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
   */
  buildGasMine: async (world, unitType) => {
    const { agent, resources } = world;
    const { actions, map } = resources.get();
    const collectedActions = [];
    try {
      if (map.freeGasGeysers().length > 0) {
        const [ geyser ] = map.freeGasGeysers();
        const { pos } = geyser;
        if (pos === undefined) return collectedActions;
        if (agent.canAfford(unitType)) {
          await actions.sendAction(assignAndSendWorkerToBuild(world, unitType, pos));
          planService.pausePlan = false;
        } else {
          collectedActions.push(...premoveBuilderToPosition(world, pos, unitType));
        }
      }
    } catch (error) {
      console.log(error);
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
        const idleBuildingsWithTechLab = nonOrphanTechLabs
          .map(techLab => units.getClosest(getAddOnBuildingPosition(techLab.pos), units.getAlive(Alliance.SELF), 1)[0])
          .filter(building => building.noQueue && getPendingOrders(building).length === 0);
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
        let setEarmark = !hasEarmarks(data);
        const planStep = plan[step];
        await builderSupplyOrTrain(world, planStep);
        const { candidatePositions, orderType, unitType, targetCount, upgrade } = planStep;
        if (orderType === 'UnitType') {
          if (unitType === undefined || unitType === null) break;
          const { attributes } = data.getUnitTypeData(unitType); if (attributes === undefined) break;
          const isStructure = attributes.includes(Attribute.STRUCTURE);
          let { minerals } = agent; if (minerals === undefined) break;
          if (!isStructure) {
            await train(world, unitType, targetCount);
          } else if (isStructure) {
            await build(world, unitType, targetCount, candidatePositions);
          }
        } else if (orderType === 'Upgrade') {
          if (upgrade === undefined || upgrade === null) break;
          await planActions.upgrade(world, upgrade);
        }
        setFoodUsed(world);
        if (setEarmark && hasEarmarks(data)) {
          const earmarkTotals = data.getEarmarkTotals('');
          const { minerals: mineralsEarmarked, vespene: vespeneEarmarked } = earmarkTotals;
          const mineralsNeeded = mineralsEarmarked - minerals > 0 ? mineralsEarmarked - minerals : 0;
          const vespeneNeeded = vespeneEarmarked - vespene > 0 ? vespeneEarmarked - vespene : 0;
          balanceResources(world, mineralsNeeded / vespeneNeeded);
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
