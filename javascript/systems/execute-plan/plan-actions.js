//@ts-check
"use strict"

const { WarpUnitAbility, UnitType, UnitTypeId, UpgradeId } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { addonTypes, techLabTypes } = require("@node-sc2/core/constants/groups");
const { GasMineRace, TownhallRace } = require("@node-sc2/core/constants/race-map");
const { PHOTONCANNON, PYLON, WARPGATE, TECHLAB, BARRACKS } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const canBuild = require("../../helper/can-afford");
const { getAvailableExpansions, getNextSafeExpansion } = require("../../helper/expansions");
const { countTypes } = require("../../helper/groups");
const { inTheMain } = require("../../helper/placement/placement-helper");
const { getAddOnBuildingPosition } = require("../../helper/placement/placement-utilities");
const { warpIn } = require("../../helper/protoss");
const { addAddOn } = require("../../helper/terran");
const worldService = require("../../services/world-service");
const planService = require("../../services/plan-service");
const { balanceResources } = require("../manage-resources");
const { checkUnitCount } = require("../track-units/track-units-service");
const unitTrainingService = require("../unit-training/unit-training-service");
const { checkBuildingCount, findAndPlaceBuilding, unpauseAndLog, premoveBuilderToPosition } = require("../../services/world-service");
const { addEarmark, isTrainingUnit } = require("../../services/data-service");
const getRandom = require("@node-sc2/core/utils/get-random");
const { createUnitCommand } = require("../../services/actions-service");
const { CANCEL_QUEUE5 } = require("@node-sc2/core/constants/ability");

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
   * @returns {Promise<void>}
   */
  build: async (world, unitType, targetCount = null) => {
    const collectedActions = [];
    const { agent, data, resources } = world;
    const { actions, map, units } = resources.get();
    if (checkBuildingCount(world, unitType, targetCount) || targetCount === null) {
      const { race } = world.agent;
      let candidatePositions = [];
      switch (true) {
        case GasMineRace[race] === unitType:
          try {
            if (map.freeGasGeysers().length > 0) {
              if (agent.canAfford(unitType)) {
                if (units.getWorkers().length > 0) {
                  await actions.buildGasMine();
                  unpauseAndLog(world, UnitTypeId[unitType]);
                  addEarmark(data, data.getUnitTypeData(unitType));
                }
              } else {
                const position = map.freeGasGeysers()[0].pos;
                collectedActions.push(...premoveBuilderToPosition(world, position, unitType));
                const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
                await balanceResources(world, mineralCost / vespeneCost);
                planService.pausePlan = true;
                planService.continueBuild = false;
              }
            }
          } catch (error) {
            console.log(error);
            planService.pausePlan = true;
            planService.continueBuild = false;
          }
          break;
        case TownhallRace[race].includes(unitType):
          if (TownhallRace[race].indexOf(unitType) === 0) {
            if (units.getBases().length !== 2) {
              const availableExpansions = getAvailableExpansions(resources);
              candidatePositions = availableExpansions.length > 0 ? [await getNextSafeExpansion(world, availableExpansions)] : [];
              collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions));
            } else {
              candidatePositions = await inTheMain(resources, unitType);
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
        case PHOTONCANNON === unitType:
          candidatePositions = map.getNatural().areas.placementGrid;
          collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions));
          break;
        case addonTypes.includes(unitType):
          const abilityIds = worldService.getAbilityIdsForAddons(data, unitType);
          let canDoTypes = worldService.getUnitTypesWithAbilities(data, abilityIds);
          const addOnUnits = units.withLabel('addAddOn');
          const unitsCanDo = addOnUnits.filter(unit => abilityIds.some(abilityId => unit.abilityAvailable(abilityId))).length > 0 ? addOnUnits : units.getByType(canDoTypes).filter(unit => abilityIds.some(abilityId => unit.abilityAvailable(abilityId)));
          if (unitsCanDo.length > 0) {
            let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
            await addAddOn(world, unitCanDo, unitType)
          } else {
            const busyCanDoTypes = units.getById(canDoTypes);
            const randomBusyTrainingUnit = getRandom(busyCanDoTypes.filter(unit => isTrainingUnit(data, unit)));
            if (randomBusyTrainingUnit) {
              await actions.sendAction(createUnitCommand(CANCEL_QUEUE5, [randomBusyTrainingUnit]));
            } else {
              const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
              await balanceResources(world, mineralCost / vespeneCost);
              planService.pausePlan = true;
              planService.continueBuild = false;
            }
          }
          break;
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
  train: async (world, unitType, targetCount = null) => {
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    let unitTypeData = data.getUnitTypeData(unitType);
    let { abilityId } = unitTypeData;
    if (checkUnitCount(world, unitType, targetCount) || targetCount === null) {
      if (canBuild(agent, data, unitType)) {
        const trainer = units.getProductionUnits(unitType).find(unit => (unit.noQueue || (unit.hasReactor() && unit.orders.length < 2)) && unit.abilityAvailable(abilityId));
        if (trainer) {
          const unitCommand = {
            abilityId,
            unitTags: [trainer.tag],
          }
          await actions.sendAction([unitCommand]);
        } else {
          abilityId = WarpUnitAbility[unitType]
          const warpGates = units.getById(WARPGATE).filter(warpgate => warpgate.abilityAvailable(abilityId));
          if (warpGates.length > 0) {
            await warpIn(resources, this, unitType);
          } else {
            planService.pausePlan = true;
            return;
          }
        }
        unpauseAndLog(world, UnitTypeId[unitType]);
        addEarmark(data, data.getUnitTypeData(unitType));
        console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`);
        unitTrainingService.selectedTypeToBuild = null;
      } else {
        if (!agent.canAfford(unitType)) {
          console.log(`${agent.foodUsed}: Cannot afford ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`, planService.isPlanPaused);
          const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
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
      const orphanTechLab = techLabs.filter(techLab => techLab.unitType === TECHLAB);
      if (orphanTechLab.length > 0) { }
      else {
        const nonOrphanTechLab = techLabs.filter(techLab => techLab.unitType !== TECHLAB);
        // find idle building with tech lab.
        const idleBuildingsWithTechLab = nonOrphanTechLab.map(techLab => units.getClosest(getAddOnBuildingPosition(techLab.pos), units.getAlive(Alliance.SELF), 1)[0]).filter(building => building.noQueue);;
        // find closest barracks to closest tech lab.
        let closestPair = [];
        units.getById(countTypes.get(BARRACKS)).forEach(barracks => {
          if (barracks.buildProgress >= 1 && barracks.noQueue) {
            idleBuildingsWithTechLab.forEach(techLab => {
              if (closestPair.length > 0) {
                closestPair = distance(barracks.pos, techLab.pos) < distance(closestPair[0].pos, closestPair[1].pos) ? [barracks, techLab] : closestPair;
              } else { closestPair = [barracks, techLab]; }
            });
          }
        });
        if (closestPair.length > 0) {
          const label = 'swapBuilding';
          closestPair[0].labels.set(label, closestPair[1].pos);
          closestPair[1].labels.set(label, closestPair[0].pos);
        }
      }
    }
  }
}

module.exports = planActions;