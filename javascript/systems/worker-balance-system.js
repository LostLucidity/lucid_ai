//@ts-check
"use strict"

const debugDebug = require('debug')('sc2:debug:WorkerBalance');
const debugSilly = require('debug')('sc2:silly:WorkerBalance');
const { createSystem } = require('@node-sc2/core');
const Ability = require('@node-sc2/core/constants/ability');
const { Alliance } = require('@node-sc2/core/constants/enums');
const { gatheringAbilities, rallyWorkersAbilities } = require('@node-sc2/core/constants/groups');
const { distance } = require('@node-sc2/core/utils/geometry/point');
const planService = require('../services/plan-service');
const { getClosestUnitByPath } = require('../services/resources-service');
const { balanceResources, gatherOrMine } = require('./manage-resources');
const { gather } = require('./unit-resource/unit-resource-service');
const unitResourceService = require('./unit-resource/unit-resource-service');

module.exports = createSystem({
  name: 'WorkerBalanceSystem',
  type: 'agent',
  defaultOptions: {
    stepIncrement: 48,
    state: {},
  },
  async onGameStart(world) {
    const { resources } = world;
    const collectedActions = [];
    collectedActions.push(...splitWorkers(resources));
    return collectedActions;
  },
  async onStep(world) {
    const { resources } = world;
    const { units, actions } = resources.get();
    if (!planService.isPlanPaused) { balanceResources(world) }
    const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
    const gatheringWorkers = units.getWorkers().filter(u => u.orders.some(o => [...gatheringAbilities].includes(o.abilityId)));
    const townhalls = units.getAlive(readySelfFilter).filter(u => u.isTownhall());
    const needyTownhall = townhalls.filter(townhall => {
      if (townhall['enemyUnits']) {
        let [closestEnemyUnit] = units.getClosest(townhall.pos, townhall['enemyUnits'], 1);
        if (closestEnemyUnit) {
          return townhall['selfDPSHealth'] >= closestEnemyUnit['selfDPSHealth'];
        }
      }
      return true;
    }).find(base => base.assignedHarvesters < base.idealHarvesters);
    if (needyTownhall) {
      const possibleDonerThs = townhalls.filter(townhall => townhall.assignedHarvesters > needyTownhall.assignedHarvesters + 1);
      // debugSilly('possible ths', possibleDonerThs.map(th => th.tag));
      const [givingTownhall] = units.getClosest(needyTownhall.pos, possibleDonerThs);

      debugSilly('possible doners', gatheringWorkers.map(worker => worker.tag));

      if (givingTownhall && gatheringWorkers.length > 0) {
        debugSilly('chosen closest th', givingTownhall.tag);
        const [donatingWorker] = units.getClosest(givingTownhall.pos, gatheringWorkers);
        debugSilly('chosen worker', donatingWorker.tag);
        const [mineralFieldTarget] = units.getClosest(needyTownhall.pos, units.getMineralFields());
        await actions.gather(donatingWorker, mineralFieldTarget, false);
      }
    }
    // catch missed idle units and have them gather or mine
    const collectedActions = [];
    collectedActions.push(...splitWorkers(resources));
    collectedActions.push(...gatherOrMineIdleGroup(world));
    await actions.sendAction(collectedActions);
  },
  /**
   * 
   * @param {World} param0 
   * @param {Unit} idleUnit 
   * @returns {Promise<SC2APIProtocol.ResponseAction|void>}
   */
  async onUnitIdle({ resources }, idleUnit) {
    if (idleUnit.isWorker() && idleUnit.noQueue) {
      const { actions, units } = resources.get();
      if (units.getBases(Alliance.SELF).length > 0) {
        console.log('gatherOrMine');
        return actions.sendAction(gatherOrMine(resources, idleUnit));
      }
    }
  },
  async onUnitFinished({ resources }, newBuilding) {
    const collectedActions = [];
    const { actions, units } = resources.get();
    if (newBuilding.isTownhall()) {
      const [mineralFieldTarget] = units.getClosest(newBuilding.pos, units.getMineralFields());
      const rallyAbility = rallyWorkersAbilities.find(ability => newBuilding.abilityAvailable(ability));
      collectedActions.push({
        abilityId: rallyAbility,
        targetUnitTag: mineralFieldTarget.tag,
        unitTags: [newBuilding.tag]
      });
      const bases = units.getBases();
      const expansionsWithExtraWorkers = bases.filter(base => base.assignedHarvesters > base.idealHarvesters);
      const gatheringWorkers = units.getWorkers().filter(u => u.orders.some(o => [...gatheringAbilities].includes(o.abilityId)));
      debugSilly(`expansions with extra workers: ${expansionsWithExtraWorkers.map(ex => ex.tag).join(', ')}`);
      const extraWorkers = expansionsWithExtraWorkers.reduce((workers, base) => {
        return workers.concat(
          units.getClosest(
            base.pos,
            gatheringWorkers,
            base.assignedHarvesters - base.idealHarvesters
          )
        );
      }, []);
      debugSilly(`total extra workers: ${extraWorkers.map(w => w.tag).join(', ')}`);
      extraWorkers.forEach(worker => {
        collectedActions.push({
          abilityId: Ability.SMART,
          targetUnitTag: mineralFieldTarget.tag,
          unitTags: [worker.tag],
        });
      })
    }
    await actions.sendAction(collectedActions);
  }
});
/**
 * @param {World} world 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function gatherOrMineIdleGroup(world) {
  const { resources } = world;
  const { units, } = world.resources.get();
  const collectedActions = [];
  // idle workers should include workers that have a move command onto a structure
  const idleWorkers = units.getWorkers().filter(worker => {
    return (
      worker.orders.length === 0 ||
      worker.orders.some(order => {
        return (
          order.abilityId === Ability.MOVE &&
          order.targetUnitTag !== undefined &&
          units.getByTag(order.targetUnitTag).isStructure()
        )
      })
    );
  });
  // const idleWorkers = units.getWorkers().filter(worker => worker.isIdle());
  idleWorkers.forEach(idleWorker => {
    console.log('idle worker.orders', idleWorker.orders);
    collectedActions.push(gatherOrMine(resources, idleWorker));
  });
  return collectedActions;
}

/**
 * 
 * @param {ResourceManager} resources 
 */
function splitWorkers(resources) {
  const { map, units } = resources.get();
  const gatheringMineralWorkers = units.getWorkers()
    .filter(worker => worker.isGathering('minerals') || worker['pendingOrders'] && worker['pendingOrders'].some((/** @type {SC2APIProtocol.UnitOrder} */ order) => gatheringAbilities.includes(order.abilityId)));
  const collectedActions = [];
  gatheringMineralWorkers.forEach(worker => {
    const [closestBase] = getClosestUnitByPath(resources, worker.pos, units.getBases());
    if (closestBase) {
      const [closestExpansion] = map.getExpansions().sort((a, b) => {
        return distance(a.townhallPosition, closestBase.pos) - distance(b.townhallPosition, closestBase.pos);
      });
      const { mineralFields } = closestExpansion.cluster;
      const mineralFieldCounts = mineralFields.map(mineralField => {
        const targetMineralFieldWorkers = gatheringMineralWorkers.filter(worker => {
          const foundOrder = findGatheringOrder(units, worker);
          return foundOrder && foundOrder.targetUnitTag === mineralField.tag;
        });
        return { mineralFieldTag: mineralField.tag, count: targetMineralFieldWorkers.length };
      }).sort((a, b) => a.count - b.count);
      const currentMineralFieldTarget = findGatheringOrder(units, worker).targetUnitTag;
      const currentMineralFieldTargetCount = mineralFieldCounts.find(({ mineralFieldTag }) => mineralFieldTag === currentMineralFieldTarget);
      if (currentMineralFieldTargetCount && distance(worker.pos, units.getByTag(currentMineralFieldTarget).pos) > 1.62) {
        const mineralFieldCandidates = mineralFieldCounts.filter(({ count }) => count + 1 < currentMineralFieldTargetCount.count);
        if (mineralFieldCandidates.length > 0) {
          const minimalCandidates = mineralFieldCandidates.filter(({ count }) => count === mineralFieldCandidates[0].count);
          const [closestMineralField] = getClosestUnitByPath(resources, worker.pos, minimalCandidates.map(({ mineralFieldTag }) => units.getByTag(mineralFieldTag)));
          const unitCommand = gather(units, worker, closestMineralField, false);
          collectedActions.push(unitCommand);
          unitResourceService.setPendingOrders(worker, unitCommand);
        }
      }
    }
  });
  return collectedActions;
}

/**
 * @param {UnitResource} units
 * @param {Unit} worker
 * @returns {SC2APIProtocol.UnitOrder}
 */
function findGatheringOrder(units, worker) {
  const foundPendingOrder = worker['pendingOrders'] && worker['pendingOrders'].find((/** @type {SC2APIProtocol.ActionRawUnitCommand} */ order) => {
    return order.targetUnitTag && units.getByTag(order.targetUnitTag).isMineralField();
  });
  if (foundPendingOrder) {
    return foundPendingOrder;
  } else {
    return worker.orders.find(order => gatheringAbilities.includes(order.abilityId));
  }
}