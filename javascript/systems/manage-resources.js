//@ts-check
"use strict"

const { Alliance, Attribute } = require("@node-sc2/core/constants/enums");
const { gatheringAbilities, mineralFieldTypes, gasMineTypes } = require("@node-sc2/core/constants/groups");
const { checkBuildingCount } = require("../helper");
const { gasMineCheckAndBuild } = require("../helper/balance-resources");
const planService = require("../services/plan-service");
const { checkUnitCount } = require("./track-units/track-units-service");
const debugSilly = require('debug')('sc2:silly:WorkerBalance');

const manageResources = {
  balanceForFuture: async (world, action, stepCount = 3) => {
    const { plan } = planService;
    const currentStep = planService.currentStep;
    if (currentStep !== null) {
      const steps = [plan[currentStep]];
      for (let step = 1; step <= stepCount; step++) {
        const nextStep = plan[currentStep + step];
        if (nextStep.orderType === 'UnitType') {
          const isStructure = world.data.getUnitTypeData(nextStep.unitType).attributes.includes(Attribute.STRUCTURE);
          let useNextStep;
          if (isStructure) {
            useNextStep = checkBuildingCount(world, nextStep.unitType, nextStep.targetCount)
          } else {
            useNextStep = checkUnitCount(world, nextStep.unitType, nextStep.targetCount)
          }
          if (useNextStep) { steps.push(nextStep); };
        } else if (nextStep.orderType === 'Upgrade') {
          const upgraders = world.resources.get().units.getUpgradeFacilities(nextStep.upgrade);
          const { abilityId } = world.data.getUpgradeData(nextStep.upgrade);
          const foundUpgradeInProgress = upgraders.find(upgrader => upgrader.orders.find(order => order.abilityId === abilityId));
          if (!world.agent.upgradeIds.includes(nextStep.upgrade) && foundUpgradeInProgress === undefined) { steps.push(nextStep); }
        }
      }
      const { totalMineralCost, totalVespeneCost } = manageResources.getResourceDemand(world.data, steps);
      await manageResources.balanceResources(world, totalMineralCost / totalVespeneCost);
    } else {
      let { mineralCost, vespeneCost } = world.data.getUnitTypeData(action);
      await manageResources.balanceResources(world, mineralCost / vespeneCost);
    }
  },
  balanceResources: async ({ agent, data, resources }, targetRatio = 16 / 6) => {
    const { actions, units } = resources.get();
    const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
    const needyGasMines = units.getGasMines(readySelfFilter).find(u => u.assignedHarvesters < u.idealHarvesters);
    const { mineralMinerCount, vespeneMinerCount } = getMinerCount(units);
    const mineralMinerCountRatio = mineralMinerCount / vespeneMinerCount;
    const needyBases = units.getBases(readySelfFilter).find(u => u.assignedHarvesters < u.idealHarvesters + 2);
    if (mineralMinerCountRatio > targetRatio) {
      const decreaseRatio = (mineralMinerCount - 1) / (vespeneMinerCount + 1);
      if ((mineralMinerCountRatio + decreaseRatio) / 2 > targetRatio) {
        if (needyGasMines) {
          const townhalls = units.getBases(readySelfFilter);
          // const possibleDonerThs = townhalls.filter(townhall => townhall.assignedHarvesters > needyGasMine.assignedHarvesters + 1);
          // debugSilly('possible ths', possibleDonerThs.map(th => th.tag));
          // const [givingTownhall] = units.getClosest(needyGasMine.pos, possibleDonerThs);
          debugSilly('possible ths', townhalls.map(th => th.tag));
          const [givingTownhall] = units.getClosest(needyGasMines.pos, townhalls);
          const gatheringMineralWorkers = units.getWorkers()
            .filter(unit => unit.orders.some(order => {
              return (
                [...gatheringAbilities].includes(order.abilityId) &&
                order.targetUnitTag &&
                mineralFieldTypes.includes(units.getByTag(order.targetUnitTag).unitType)
              );
            }));
          debugSilly('possible doners', gatheringMineralWorkers.map(worker => worker.tag));
          if (givingTownhall && gatheringMineralWorkers.length > 0) {
            debugSilly('chosen closest th', givingTownhall.tag);
            const [donatingWorker] = units.getClosest(givingTownhall.pos, gatheringMineralWorkers);
            debugSilly('chosen worker', donatingWorker.tag);
            await actions.mine([donatingWorker], needyGasMines, false);
          }
        } else {
          gasMineCheckAndBuild({ agent, data, resources })
        }
      }
    } else if (mineralMinerCountRatio === targetRatio) {
      return;
    } else if (needyBases && mineralMinerCountRatio < targetRatio) {
      const increaseRatio = (mineralMinerCount + 1) / (vespeneMinerCount - 1);
      if ((mineralMinerCountRatio + increaseRatio) / 2 < targetRatio) {
        const gasMines = units.getAlive(readySelfFilter).filter(u => u.isGasMine());
        const [givingGasMine] = units.getClosest(needyBases.pos, gasMines);
        const gatheringGasWorkers = units.getWorkers()
          .filter(unit => unit.orders.some(order => {
            return (
              [...gatheringAbilities].includes(order.abilityId) &&
              order.targetUnitTag &&
              gasMineTypes.includes(units.getByTag(order.targetUnitTag).unitType)
            );
          }));
        if (givingGasMine && gatheringGasWorkers.length > 0) {
          debugSilly('chosen closest th', givingGasMine.tag);
          const [donatingWorker] = units.getClosest(givingGasMine.pos, gatheringGasWorkers);
          debugSilly('chosen worker', donatingWorker.tag);
          await actions.gather(donatingWorker, null, false);
        }
      }
    }
  },
  async gatherOrMine(resources, unit) {
    const { actions, units } = resources.get();
    const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
    const needyGasMine = units.getGasMines(readySelfFilter).find(u => u.assignedHarvesters < u.idealHarvesters);
    const { mineralMinerCount, vespeneMinerCount } = getMinerCount(units);
    needyGasMine && mineralMinerCount / vespeneMinerCount > 16 / 6 ? await actions.mine(unit, needyGasMine, false) : await actions.gather(unit, null, false);
  },
  getResourceDemand(data, steps) {
    let totalMineralCost = 0;
    let totalVespeneCost = 0;
    steps.forEach(step => {
      if (step.orderType === 'UnitType') {
        let { mineralCost, vespeneCost } = data.getUnitTypeData(step.unitType);
        totalMineralCost += mineralCost;
        totalVespeneCost += vespeneCost;
      } else if (step.orderType === 'Upgrade') {
        let { mineralCost, vespeneCost } = data.getUpgradeData(step.upgrade);
        totalMineralCost += mineralCost;
        totalVespeneCost += vespeneCost;
      }
    });
    return { totalMineralCost, totalVespeneCost };
  },
}

function getMinerCount(units) {
  const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
  const mineralMinerCount = units.getBases(readySelfFilter).reduce((accumulator, currentValue) => accumulator + currentValue.assignedHarvesters, 0);
  const vespeneMinerCount = units.getGasMines(readySelfFilter).reduce((accumulator, currentValue) => accumulator + currentValue.assignedHarvesters, 0);
  return { mineralMinerCount, vespeneMinerCount }
}

module.exports = manageResources;