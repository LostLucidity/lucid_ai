//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { gatheringAbilities, mineralFieldTypes } = require("@node-sc2/core/constants/groups");
const { COMMANDCENTER, MULE } = require("@node-sc2/core/constants/unit-type");
const getRandom = require("@node-sc2/core/utils/get-random");
const { gasMineCheckAndBuild } = require("../helper/balance-resources");
const { upgradeTypes } = require("../helper/groups");
const { gather } = require("../services/resource-manager-service");
const { mine, getPendingOrders, setPendingOrders } = require("../services/unit-service");
const { getGatheringWorkers, isMining } = require("./unit-resource/unit-resource-service");
const debugSilly = require('debug')('sc2:silly:WorkerBalance');

const manageResources = {
  /**
   * @param {World} world
   * @param {number} targetRatio
   */
  balanceResources: async (world, targetRatio = 16 / 6) => {
    const { agent, data, resources } = world;
    const { minerals, vespene } = agent; if (minerals === undefined || vespene === undefined) return;
    const { actions, units } = resources.get();
    targetRatio = isNaN(targetRatio) ? 16 / 6 : targetRatio;
    const maxRatio = 32 / 6;
    const increaseRatio = targetRatio > maxRatio || (vespene > 512 && minerals < 512);
    targetRatio = increaseRatio ? maxRatio : targetRatio;
    const needyGasMines = getNeedyGasMines(units);
    const { mineralMinerCount, vespeneMinerCount } = getMinerCount(units);
    const mineralMinerCountRatio = mineralMinerCount / vespeneMinerCount;
    const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
    const needyBase = units.getBases(readySelfFilter).find(base => {
      const { assignedHarvesters, idealHarvesters } = base; if (assignedHarvesters === undefined || idealHarvesters === undefined) return false;
      return assignedHarvesters < idealHarvesters;
    });
    if (mineralMinerCountRatio > targetRatio) {
      const decreaseRatio = (mineralMinerCount - 1) / (vespeneMinerCount + 1);
      if ((mineralMinerCountRatio + decreaseRatio) / 2 >= targetRatio) {
        if (needyGasMines.length > 0) {
          const townhalls = units.getBases(readySelfFilter);
          // const possibleDonerThs = townhalls.filter(townhall => townhall.assignedHarvesters > needyGasMine.assignedHarvesters + 1);
          // debugSilly('possible ths', possibleDonerThs.map(th => th.tag));
          // const [givingTownhall] = units.getClosest(needyGasMine.pos, possibleDonerThs);
          debugSilly('possible ths', townhalls.map(th => th.tag));
          const needyGasMine = getRandom(needyGasMines);
          const { pos } = needyGasMine;
          if (pos === undefined) return;
          const [givingTownhall] = units.getClosest(pos, townhalls);
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
            await actions.mine([donatingWorker], needyGasMine, false);
            setPendingOrders(donatingWorker, mine(donatingWorker, needyGasMine, false));
          }
        } else {
          gasMineCheckAndBuild({ agent, data, resources })
        }
      }
    } else if (mineralMinerCountRatio === targetRatio) {
      return;
    } else if (needyBase && mineralMinerCountRatio < targetRatio) {
      const { pos: basePos } = needyBase; if (basePos === undefined) return;
      const increaseRatio = (mineralMinerCount + 1) / (vespeneMinerCount - 1);
      if ((mineralMinerCountRatio + increaseRatio) / 2 <= targetRatio) {
        const gasMines = units.getAlive(readySelfFilter).filter(u => u.isGasMine());
        const [givingGasMine] = units.getClosest(basePos, gasMines);
        const gatheringGasWorkers = getGatheringWorkers(units, "vespene").filter(worker => !isMining(units, worker));
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
   * @param {Unit|null} mineralField
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  gatherOrMine(resources, unit, mineralField = null) {
    const { units } = resources.get();
    if (units.getBases(Alliance.SELF).filter(b => b.buildProgress >= 1).length > 0) {
      const needyGasMines = getNeedyGasMines(units);
      const needyGasMine = getRandom(needyGasMines);
      const { mineralMinerCount, vespeneMinerCount } = getMinerCount(units);
      return needyGasMine && mineralMinerCount / vespeneMinerCount > 16 / 6 ? [mine(unit, needyGasMine, false)] : gather(resources, unit, mineralField, false);
    } else {
      return [];
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

/**
 * @param {UnitResource} units 
 * @returns {Unit[]}
 */
function getNeedyGasMines(units) {
  const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
  return units.getGasMines(readySelfFilter).filter(gasMine => {
    const { assignedHarvesters, idealHarvesters } = gasMine;
    if (assignedHarvesters === undefined || idealHarvesters === undefined) return false;
    // find workers that are targeting this gas mine
    const workers = units.getWorkers().filter(worker => {
      const pendingOrders = getPendingOrders(worker);
      return pendingOrders.some(order => {
        const { abilityId, targetUnitTag } = order;
        if (abilityId === undefined || targetUnitTag === undefined) return false;
        return (
          [...gatheringAbilities].includes(abilityId) &&
          targetUnitTag === gasMine.tag
        );
      });
    });
    const assignedHarvestersWithWorkers = assignedHarvesters + workers.length;
    return assignedHarvestersWithWorkers < idealHarvesters;
  });
}
