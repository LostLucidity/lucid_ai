//@ts-check
"use strict"

const { WarpUnitAbility, UnitType } = require("@node-sc2/core/constants");
const { MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { addonTypes, techLabTypes } = require("@node-sc2/core/constants/groups");
const { GasMineRace, TownhallRace } = require("@node-sc2/core/constants/race-map");
const { PHOTONCANNON, PYLON, WARPGATE, TECHLAB, BARRACKS } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { checkBuildingCount, workerSendOrBuild } = require("../../helper");
const canBuild = require("../../helper/can-afford");
const { getAvailableExpansions, getNextSafeExpansion } = require("../../helper/expansions");
const { countTypes } = require("../../helper/groups");
const { findPlacements, findPosition, inTheMain } = require("../../helper/placement/placement-helper");
const { getAddOnBuildingPosition } = require("../../helper/placement/placement-utilities");
const { warpIn } = require("../../helper/protoss");
const { addAddOn } = require("../../helper/terran");
const planService = require("../../services/plan-service");
const { balanceForFuture } = require("../manage-resources");
const { checkUnitCount } = require("../track-units/track-units-service");
const unitTrainingService = require("../unit-training/unit-training-service");

module.exports = {
  ability: async (world, abilityId) => {
    const { data, resources } = world;
    const { actions, units } = resources.get();
    let canDoTypes = data.findUnitTypesWithAbility(abilityId);
    if (canDoTypes.length === 0) {
      canDoTypes = units.getAlive(Alliance.SELF);
    }
    const unitsCanDo = units.getByType(canDoTypes).filter(unit => unit.alliance === Alliance.SELF);
    if (unitsCanDo.length > 0) {
      if (unitsCanDo.filter(unit => unit.abilityAvailable(abilityId)).length > 0) {
        let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
        const unitCommand = { abilityId, unitTags: [unitCanDo.tag] }
        await actions.sendAction([unitCommand]);
        planService.pauseBuilding = false;
        planService.continueBuild = true;
      } else {
        unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
        planService.pauseBuilding = true;
        planService.continueBuild = false;
      }
    }
  },
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
                await actions.buildGasMine();
                planService.pauseBuilding = false;
              } else {
                collectedActions.push(...workerSendOrBuild(resources, MOVE, map.freeGasGeysers()[0].pos));
                await balanceForFuture(world, unitType)
                planService.pauseBuilding = true;
                planService.continueBuild = false;
              }
            }
          } catch (error) {
            console.log(error);
            planService.pauseBuilding = true;
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
            await module.exports.ability(world, data.getUnitTypeData(unitType).abilityId)
          }
          break;
        case PHOTONCANNON === unitType:
          candidatePositions = map.getNatural().areas.placementGrid;
          collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions));
          break;
        case addonTypes.includes(unitType):
          let abilityId = data.getUnitTypeData(unitType).abilityId;
          let canDoTypes = data.findUnitTypesWithAbility(abilityId);
          const addOnUnits = units.withLabel('addAddOn');
          const unitsCanDo = addOnUnits.filter(unit => unit.abilityAvailable(abilityId)).length > 0 ? addOnUnits : units.getByType(canDoTypes).filter(unit => unit.abilityAvailable(abilityId));
          if (unitsCanDo.length > 0) {
            let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
            await addAddOn(world, unitCanDo, abilityId, unitType)
          } else {
            await balanceForFuture(world, unitType);
            planService.pauseBuilding = true;
            planService.continueBuild = false;
          }
          break;
        default:
          collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions));
      }
    }
    await actions.sendAction(collectedActions);
  },
  train: async (world, unitType, targetCount = null) => {
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    let abilityId = data.getUnitTypeData(unitType).abilityId;
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
            planService.pauseBuilding = true;
            return;
          }
        }
        planService.pauseBuilding = false;
        console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`);
        unitTrainingService.selectedTypeToBuild = null;
      } else {
        if (!agent.canAfford(unitType)) {
          console.log(`${agent.foodUsed}: Cannot afford ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`, planService.pauseBuilding);
          await balanceForFuture(world, unitType);
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
    if (upgraders.length > 0) {
      const { abilityId } = data.getUpgradeData(upgradeId);
      const foundUpgradeInProgress = upgraders.find(upgrader => upgrader.orders.find(order => order.abilityId === abilityId));
      if (!agent.upgradeIds.includes(upgradeId) && foundUpgradeInProgress === undefined) {
        const upgrader = units.getUpgradeFacilities(upgradeId).find(unit => unit.noQueue && unit.abilityAvailable(abilityId));
        if (upgrader) {
          const unitCommand = { abilityId, unitTags: [upgrader.tag] };
          await actions.sendAction([unitCommand]);
          planService.pauseBuilding = false;
        } else {
          await balanceForFuture(world, upgradeId);
          planService.pauseBuilding = true;
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

async function findAndPlaceBuilding(world, unitType, candidatePositions) {
  const { agent, data, resources } = world
  const collectedActions = []
  const { actions, units } = resources.get();
  if (candidatePositions.length === 0) { candidatePositions = await findPlacements(world, unitType); }
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
      await balanceForFuture(world, unitType);
      planService.pauseBuilding = true;
      planService.continueBuild = false;
    }
  } else {
    const [pylon] = units.getById(PYLON);
    if (pylon && pylon.buildProgress < 1) {
      collectedActions.push(...workerSendOrBuild(resources, MOVE, pylon.pos));
      planService.pauseBuilding = true;
      planService.continueBuild = false;
    }
  }
  return collectedActions;
}