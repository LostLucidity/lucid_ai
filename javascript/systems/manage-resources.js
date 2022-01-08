//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { gatheringAbilities, mineralFieldTypes, gasMineTypes } = require("@node-sc2/core/constants/groups");
const { COMMANDCENTER, MULE } = require("@node-sc2/core/constants/unit-type");
const { gasMineCheckAndBuild } = require("../helper/balance-resources");
const { upgradeTypes } = require("../helper/groups");
const { mine } = require("../services/units-service");
const { gather } = require("./unit-resource/unit-resource-service");
const debugSilly = require('debug')('sc2:silly:WorkerBalance');

const manageResources = {
  balanceResources: async ({ agent, data, resources }, targetRatio = 16 / 6) => {
    targetRatio = targetRatio === Infinity ? (32 / 6) : targetRatio;
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
  /**
   * @param {ResourceManager} resources
   * @param {Unit} unit
   * @returns {SC2APIProtocol.ActionRawUnitCommand}
   */
  gatherOrMine(resources, unit) {
    const { units } = resources.get();
    if (units.getBases(Alliance.SELF).filter(b => b.buildProgress >= 1).length > 0) {
      const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
      const needyGasMine = units.getGasMines(readySelfFilter).find(u => u.assignedHarvesters < u.idealHarvesters);
      const { mineralMinerCount, vespeneMinerCount } = getMinerCount(units);
      return needyGasMine && mineralMinerCount / vespeneMinerCount > 16 / 6 ? mine(unit, needyGasMine, false) : gather(units, unit, null, false);
    }
  },
  /**
   * 
   * @param {World['data']} data 
   * @param {any[]} steps 
   * @returns {any}
   */
  getResourceDemand(data, steps) {
    let totalMineralCost = 0;
    let totalVespeneCost = 0;
    steps.forEach(step => {
      if (step.orderType === 'UnitType') {
        let { mineralCost, vespeneCost } = data.getUnitTypeData(step.unitType);
        let { adjustMineralCost, adjustVespeneCost } = adjustForUpgrades(data, step.unitType);
        totalMineralCost += mineralCost - adjustMineralCost;
        totalVespeneCost += vespeneCost - adjustVespeneCost;
      } else if (step.orderType === 'Upgrade') {
        let { mineralCost, vespeneCost } = data.getUpgradeData(step.upgrade);
        totalMineralCost += mineralCost;
        totalVespeneCost += vespeneCost;
      }
    });
    return { totalMineralCost, totalVespeneCost };
  },
}
/**
 * 
 * @param {UnitResource} units 
 * @returns {any}
 */
function getMinerCount(units) {
  const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
  let mineralMinerCount = units.getBases(readySelfFilter).reduce((accumulator, currentValue) => accumulator + currentValue.assignedHarvesters, 0);
  mineralMinerCount += (units.getById(MULE).filter(mule => mule.isHarvesting()).length * (3 + 2/3));
  const vespeneMinerCount = units.getGasMines(readySelfFilter).reduce((accumulator, currentValue) => accumulator + currentValue.assignedHarvesters, 0);
  return { mineralMinerCount, vespeneMinerCount }
}

function adjustForUpgrades(data, unitType) {
  const adjustedCost = { adjustMineralCost: 0, adjustVespeneCost: 0 };
  if (upgradeTypes.get(COMMANDCENTER).includes(unitType)) {
    const unitData = data.getUnitTypeData(COMMANDCENTER);
    adjustedCost.adjustMineralCost = unitData.mineralCost;
    adjustedCost.adjustVespeneCost = unitData.vespeneCost;
  }
  return adjustedCost;
}

module.exports = manageResources;