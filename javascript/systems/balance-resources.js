//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { gatheringAbilities } = require("@node-sc2/core/constants/groups");
const debugSilly = require('debug')('sc2:silly:WorkerBalance');

module.exports = {
  balanceResources: async (resources, agent, targetRatio=16/6) => {
    const { units } = resources.get();
    const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
    const needyGasMine = units.getGasMines(readySelfFilter).find(u => u.assignedHarvesters < u.idealHarvesters);
    const { minerals, vespene } = agent;
    const resourceRatio = minerals / vespene;
    const surplusMinerals = resourceRatio > targetRatio;
    if (needyGasMine && surplusMinerals) {
      const townhalls = units.getAlive(readySelfFilter).filter(u => u.isTownhall());
      // const possibleDonerThs = townhalls.filter(townhall => townhall.assignedHarvesters > needyGasMine.assignedHarvesters + 1);
      // debugSilly('possible ths', possibleDonerThs.map(th => th.tag));
      // const [givingTownhall] = units.getClosest(needyGasMine.pos, possibleDonerThs);
      debugSilly('possible ths', townhalls.map(th => th.tag));
      const [givingTownhall] = units.getClosest(needyGasMine.pos, townhalls);
      const gatheringWorkers = units.getWorkers().filter(u => u.orders.some(o => [...gatheringAbilities].includes(o.abilityId)));
      debugSilly('possible doners', gatheringWorkers.map(worker => worker.tag));
      if (givingTownhall && gatheringWorkers.length > 0) {
        debugSilly('chosen closest th', givingTownhall.tag);
        const [donatingWorker] = units.getClosest(givingTownhall.pos, gatheringWorkers);
        debugSilly('chosen worker', donatingWorker.tag);
        const { actions } = resources.get();
        await actions.mine([donatingWorker], needyGasMine, false);
      }
    }
  },
  async gatherOrMine(resources, unit) {
    const { actions, units } = resources.get();
    const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
    const needyGasMine = units.getGasMines(readySelfFilter).find(u => u.assignedHarvesters < u.idealHarvesters);
    const townhalls = units.getAlive(readySelfFilter).filter(u => u.isTownhall());
    const mineralMinerCount = townhalls.map(townhall => townhall.assignedHarvesters).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
    const gasMinerCount = units.getGasMines(readySelfFilter).map(mine => mine.assignedHarvesters).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
    needyGasMine && mineralMinerCount/gasMinerCount > 16/6 ? await actions.mine(unit, needyGasMine) : await actions.gather(unit);
  }
}
