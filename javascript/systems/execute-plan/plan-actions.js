//@ts-check
"use strict"

const { WarpUnitAbility, UnitType } = require("@node-sc2/core/constants");
const { MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { addonTypes } = require("@node-sc2/core/constants/groups");
const { GasMineRace, TownhallRace } = require("@node-sc2/core/constants/race-map");
const { PHOTONCANNON, PYLON, WARPGATE } = require("@node-sc2/core/constants/unit-type");
const { checkBuildingCount, workerSendOrBuild } = require("../../helper");
const canBuild = require("../../helper/can-afford");
const { expand } = require("../../helper/general-actions");
const { findPlacements, findPosition } = require("../../helper/placement-helper");
const { warpIn } = require("../../helper/protoss");
const { addAddOn } = require("../../helper/terran");
const planService = require("../../services/plan-service");
const { balanceResources } = require("../balance-resources");

module.exports = {
  ability: async (world, abilityId) => {
    const { data, resources } = world;
    const { actions, units } = resources.get();
    let canDoTypes = data.findUnitTypesWithAbility(abilityId);
    if (canDoTypes.length === 0) {
      canDoTypes = units.getAlive(Alliance.SELF).filter(unit => unit.abilityAvailable(abilityId)).map(canDoUnit => canDoUnit.unitType);
    }
    const unitsCanDo = units.getByType(canDoTypes).filter(unit => unit.abilityAvailable(abilityId));
    if (unitsCanDo.length > 0) {
      let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
      const unitCommand = { abilityId, unitTags: [unitCanDo.tag] }
      await actions.sendAction([unitCommand]);
      planService.pauseBuilding = false;
    }
  },
  build: async (world, unitType, targetCount) => {
    const collectedActions = [];
    if (checkBuildingCount(world, unitType, targetCount)) {
      const { agent, data, resources } = world;
      const { race } = world.agent;
      const { actions, map, units } = resources.get();
      let candidatePositions = [];
      switch (true) {
        case GasMineRace[race] === unitType:
          try {
            if (agent.canAfford(unitType) && map.freeGasGeysers().length > 0) {
              await actions.buildGasMine();
              planService.pauseBuilding = false;
            }
          } catch(error) {
            console.log(error);
            planService.pauseBuilding = true;
            planService.continueBuild = false;
          }
          break;
        case TownhallRace[race].includes(unitType):
          if (TownhallRace[race].indexOf(unitType) === 0) {
            { collectedActions.push(...await expand(world)); } 
          } else {
            await module.exports.ability(world, data.getUnitTypeData(unitType).abilityId)
          }
          break;
        case PHOTONCANNON === unitType:
          candidatePositions = map.getNatural().areas.placementGrid;
        case addonTypes.includes(unitType):
            let abilityId = data.getUnitTypeData(unitType).abilityId;
            let canDoTypes = data.findUnitTypesWithAbility(abilityId);
            const addOnUnits = units.withLabel('addAddOn');
            const unitsCanDo = addOnUnits.length > 0 ? addOnUnits : units.getByType(canDoTypes).filter(unit => unit.abilityAvailable(abilityId));
            if (unitsCanDo.length > 0) {
              let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
              await addAddOn(world, unitCanDo, abilityId, unitType)
            } else {
              const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
              await balanceResources(world, mineralCost/vespeneCost);
              planService.pauseBuilding = true;
              planService.continueBuild = false;
            }
          break;
        default:
          if (candidatePositions.length === 0) { candidatePositions = findPlacements(world, unitType); }
          planService.foundPosition = planService.foundPosition ? planService.foundPosition : await findPosition(actions, unitType, candidatePositions);
          if (planService.foundPosition) {
            if (agent.canAfford(unitType)) {
              if (await actions.canPlace(unitType, [planService.foundPosition])) {
                await actions.sendAction(workerSendOrBuild(resources, data.getUnitTypeData(unitType).abilityId, planService.foundPosition));
                planService.pauseBuilding = false;
                planService.continueBuild = false;
                planService.foundPosition = null;
              } else {
                planService.foundPosition = null;
                planService.pauseBuilding = true;
                planService.continueBuild = false;
              }
            } else {
              collectedActions.push(...workerSendOrBuild(resources, MOVE, planService.foundPosition));
              const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
              await balanceResources(world, mineralCost/vespeneCost);
              planService.pauseBuilding = true;
              planService.continueBuild = false;
            }
          } else {
            const [ pylon ] = units.getById(PYLON);
            if (pylon && pylon.buildProgress < 1) {
              collectedActions.push(...workerSendOrBuild(resources, MOVE, pylon.pos));
              planService.pauseBuilding = true;
              planService.continueBuild = false;
            }
          }
      }
    }
    return collectedActions;
  },
  train: async (world, unitType, targetCount=null) => {
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    let abilityId = data.getUnitTypeData(unitType).abilityId;
    const orders = [];
    units.withCurrentOrders(abilityId).forEach(unit => {
      unit.orders.forEach(order => { if (order.abilityId === abilityId) { orders.push(order); } });
    })        
    const unitCount = units.getById(unitType).length + orders.length
    if (targetCount === null || unitCount === targetCount) {
      if (canBuild(agent, data, unitType)) {
        const trainer = units.getProductionUnits(unitType).find(unit => (unit.noQueue || (unit.hasReactor() && unit.orders.length < 2)) && unit.abilityAvailable(abilityId));
        if (trainer) {
          const unitCommand = {
            abilityId,
            unitTags: [ trainer.tag ],
          }
          await actions.sendAction([unitCommand]);
        } else {
          abilityId = WarpUnitAbility[unitType]
          const warpGates = units.getById(WARPGATE).filter(warpgate => warpgate.abilityAvailable(abilityId));
          if (warpGates.length > 0) {
            await warpIn(resources, this, unitType);
          } else {
            planService.pauseBuilding = true;
            return;
          }
        }
        planService.pauseBuilding = false;
        console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`, planService.pauseBuilding);
      } else {
        if (!agent.canAfford(unitType)) {
          console.log(`Cannot afford ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`, planService.pauseBuilding);
          const { mineralCost, vespeneCost } = data.getUnitTypeData(unitType);
          await balanceResources(world, mineralCost/vespeneCost);
        }
        planService.pauseBuilding = true;
        planService.continueBuild = false;
      }
    }
  },
  upgrade: async (world, upgradeId) => {
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    const upgraders = units.getUpgradeFacilities(upgradeId);
    const { abilityId } = data.getUpgradeData(upgradeId);
    const foundUpgradeInProgress = upgraders.find(upgrader => upgrader.orders.find(order => order.abilityId === abilityId));
    if (!agent.upgradeIds.includes(upgradeId) && foundUpgradeInProgress === undefined) {
      const upgrader = units.getUpgradeFacilities(upgradeId).find(unit => unit.noQueue && unit.abilityAvailable(abilityId));
      if (upgrader) {
        const unitCommand = { abilityId, unitTags: [upgrader.tag] };
        await actions.sendAction([unitCommand]);
        planService.pauseBuilding = false;
      } else {
        const { mineralCost, vespeneCost } = data.getUpgradeData(upgradeId);
        await balanceResources(world, mineralCost/vespeneCost);
        planService.pauseBuilding = true;
        planService.continueBuild = false;
      }
    }
  }
}