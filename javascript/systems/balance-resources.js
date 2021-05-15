//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { gatheringAbilities, mineralFieldTypes, gasMineTypes } = require("@node-sc2/core/constants/groups");
const debugSilly = require('debug')('sc2:silly:WorkerBalance');

module.exports = {
  balanceResources: async (resources, targetRatio=16/6) => {
    const { actions, units } = resources.get();
    const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
    const needyGasMines = units.getGasMines(readySelfFilter).find(u => u.assignedHarvesters < u.idealHarvesters);
    const { mineralMinerCount, vespeneMinerCount } = getMinerCount(units);
    const mineralMinerCountRatio = mineralMinerCount / vespeneMinerCount;
    const surplusMinerals = mineralMinerCountRatio > targetRatio;
    if (needyGasMines && surplusMinerals) {
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
    }
    const needyBases = units.getBases(readySelfFilter).find(u => u.assignedHarvesters < u.idealHarvesters + 2);
    if (needyBases && !surplusMinerals) {
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
  },
  async gatherOrMine(resources, unit) {
    const { actions, units } = resources.get();
    const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
    const needyGasMine = units.getGasMines(readySelfFilter).find(u => u.assignedHarvesters < u.idealHarvesters);
    const { mineralMinerCount, vespeneMinerCount } = getMinerCount(units);
    needyGasMine && mineralMinerCount/vespeneMinerCount > 16/6 ? await actions.mine(unit, needyGasMine) : await actions.gather(unit);
  }
}

function getMinerCount(units) {
  const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
  const mineralMinerCount = units.getBases(readySelfFilter).reduce((accumulator, currentValue) => accumulator + currentValue.assignedHarvesters, 0);
  const vespeneMinerCount = units.getGasMines(readySelfFilter).reduce((accumulator, currentValue) => accumulator + currentValue.assignedHarvesters, 0);
  return { mineralMinerCount, vespeneMinerCount }
}
