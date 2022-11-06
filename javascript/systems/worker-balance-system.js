//@ts-check
"use strict"

const debugDebug = require('debug')('sc2:debug:WorkerBalance');
const debugSilly = require('debug')('sc2:silly:WorkerBalance');
const { createSystem } = require('@node-sc2/core');
const Ability = require('@node-sc2/core/constants/ability');
const { Alliance } = require('@node-sc2/core/constants/enums');
const { gatheringAbilities, rallyWorkersAbilities } = require('@node-sc2/core/constants/groups');
const { distance } = require('@node-sc2/core/utils/geometry/point');
const { createUnitCommand } = require('../services/actions-service');
const { getClosestExpansion } = require('../services/map-resource-service');
const planService = require('../services/plan-service');
const { gather } = require('../services/resource-manager-service');
const { getPendingOrders } = require('../services/unit-service');
const { balanceResources, gatherOrMine } = require('./manage-resources');
const { getMineralFieldAssignments, setPendingOrders, getNeediestMineralField } = require('./unit-resource/unit-resource-service');

module.exports = createSystem({
  name: 'WorkerBalanceSystem',
  type: 'agent',
  defaultOptions: {
    stepIncrement: 32,
    state: {},
  },
  async onGameStart(world) {
    const { resources } = world;
    const collectedActions = [];
    collectedActions.push(...assignWorkers(resources));
    return collectedActions;
  },
  async onStep(world) {
    const { resources } = world;
    const { units, actions } = resources.get();
    const collectedActions = [];
    if (!planService.isPlanPaused) { balanceResources(world) }
    const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
    const gatheringWorkers = getGatheringWorkers(units, undefined, true);
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
        const mineralFields = units.getMineralFields().filter(field => {
          const numWorkers = units.getWorkers().filter(worker => {
            const { orders } = worker;
            if (orders === undefined) { return false }
            return orders.some(order => order.targetUnitTag === field.tag);
          }).length;
          return (
            (distance(field.pos, needyTownhall.pos) < 8) &&
            (!field.labels.has('workerCount') || field.labels.get('workerCount') < 2) &&
            numWorkers < 2
          );
        });
        const [mineralFieldTarget] = units.getClosest(needyTownhall.pos, mineralFields);
        if (mineralFieldTarget) {
          donatingWorker.labels.set('mineralField', mineralFieldTarget);
          if (!mineralFieldTarget.labels.has('workerCount')) {
            mineralFieldTarget.labels.set('workerCount', 1);
          } else {
            mineralFieldTarget.labels.set('workerCount', mineralFieldTarget.labels.get('workerCount') + 1);
          }
          const unitCommand = gather(resources, donatingWorker, mineralFieldTarget, false);
          collectedActions.push(unitCommand);
          setPendingOrders(donatingWorker, unitCommand);
        } else {
          const mineralFields = units.getMineralFields();
          const [mineralFieldTarget] = units.getClosest(needyTownhall.pos, mineralFields);
          if (mineralFieldTarget) {
            donatingWorker.labels.delete('mineralField');
            const unitCommand = gather(resources, donatingWorker, mineralFieldTarget, false);
            collectedActions.push(unitCommand);
          }
        }
      }
    }
    collectedActions.push(...assignWorkers(resources));
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
    const pendingOrders = getPendingOrders(idleUnit);
    if (idleUnit.isWorker() && idleUnit.noQueue && pendingOrders.length === 0) {
      const { actions, units } = resources.get();
      if (units.getBases(Alliance.SELF).length > 0) {
        console.log('gatherOrMine');
        const unitCommand = gatherOrMine(resources, idleUnit);
        if (unitCommand) {
          return actions.sendAction(unitCommand);
        }
      }
    }
  },
  async onUnitFinished({ resources }, newBuilding) {
    const collectedActions = [];
    const { actions, map, units } = resources.get();
    const { pos } = newBuilding;
    if (pos === undefined) return;
    if (newBuilding.isTownhall()) {
      // don't assign mineral fields to the new townhall if not at same height
      const mineralFields = units.getMineralFields().filter(field => field.pos && map.getHeight(field.pos) === map.getHeight(pos) && distance(field.pos, pos) < 16);
      const [mineralFieldTarget] = units.getClosest(pos, mineralFields);
      const rallyAbility = rallyWorkersAbilities.find(ability => newBuilding.abilityAvailable(ability));
      if (mineralFieldTarget && rallyAbility) {
        const unitCommand = createUnitCommand(rallyAbility, [newBuilding]);
        unitCommand.targetUnitTag = mineralFieldTarget.tag;
        collectedActions.push(unitCommand);
      }
      const bases = units.getBases();
      const basesWithExtraWorkers = bases.filter(base => base.assignedHarvesters > base.idealHarvesters);
      const gatheringWorkers = getGatheringWorkers(units, undefined, true);
      debugSilly(`bases with extra workers: ${basesWithExtraWorkers.map(ex => ex.tag).join(', ')}`);
      // get workers from expansions with extra workers
      const extraWorkers = basesWithExtraWorkers.map(base => {
        // get closest workers to base from gathering workers equal to the difference between assigned and ideal harvesters
        const { assignedHarvesters, idealHarvesters, pos } = base;
        if (assignedHarvesters === undefined || idealHarvesters === undefined || pos === undefined) return [];
        const closestWorkers = units.getClosest(pos, gatheringWorkers, assignedHarvesters - idealHarvesters);
        return closestWorkers;
      }).flat();
      debugSilly(`total extra workers: ${extraWorkers.map(w => w.tag).join(', ')}`);
      extraWorkers.forEach(worker => {
        const neediestMineralField = getNeediestMineralField(units, mineralFields);
        if (neediestMineralField) {
          const unitCommand = gather(resources, worker, neediestMineralField, false);
          collectedActions.push(unitCommand);
          worker.labels.set('mineralField', neediestMineralField);
          neediestMineralField.labels.set('workerCount', neediestMineralField.labels.get('workerCount') + 1);
        }
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
    const { orders } = worker;
    if (orders === undefined) { return false }
    const pendingOrders = getPendingOrders(worker);
    return (
      pendingOrders.length === 0 &&
      orders.length === 0 ||
      orders.some(order => {
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
 * @returns 
 */
function assignWorkers(resources) {
  const { map, units } = resources.get();
  const collectedActions = [];
  const gatheringMineralWorkers = getGatheringWorkers(units, 'minerals', true);
  gatheringMineralWorkers.forEach(worker => {
    const { pos } = worker;
    if (pos === undefined) return;
    const [closestBase] = units.getClosest(pos, units.getBases(), 1);
    if (closestBase) {
      const [closestExpansion] = getClosestExpansion(map, closestBase.pos);
      const { mineralFields } = closestExpansion.cluster;
      /** @type {Unit} */
      const assignedMineralField = worker.labels.get('mineralField');
      if (assignedMineralField && assignedMineralField.tag !== undefined) {
        let currentMineralField = units.getByTag(assignedMineralField.tag);
        if (currentMineralField) {
          const neediestMineralField = getNeediestMineralField(units, mineralFields);
          if (neediestMineralField === undefined) return;
          if (currentMineralField.tag !== neediestMineralField.tag) {
            const leastNeediestMineralField = getLeastNeediestMineralField(units, mineralFields);
            if (leastNeediestMineralField === undefined) return;
            const assignedToLeastNeediest = currentMineralField.tag === leastNeediestMineralField.tag;
            const { mineralContents: neediestMineralContents } = neediestMineralField;
            const { mineralContents: leastNeediestMineralContents } = leastNeediestMineralField;
            if (neediestMineralContents === undefined || leastNeediestMineralContents === undefined) return;
            const neediestDoublingLeastNeediest = neediestMineralContents > leastNeediestMineralContents * 2;
            if (assignedToLeastNeediest && neediestDoublingLeastNeediest) {
              worker.labels.set('mineralField', neediestMineralField);
              neediestMineralField.labels.set('workerCount', neediestMineralField.labels.get('workerCount') + 1);
              currentMineralField.labels.set('workerCount', currentMineralField.labels.get('workerCount') - 1);
              currentMineralField = neediestMineralField;
            }
          }
          const gatheringOrder = findGatheringOrder(units, worker);
          if (gatheringOrder) {
            if (gatheringOrder.targetUnitTag !== currentMineralField.tag) {
              if (currentMineralField.labels.get('workerCount') < 3) {
                const unitCommand = gather(resources, worker, currentMineralField, false);
                collectedActions.push(unitCommand);
              } else {
                worker.labels.delete('mineralField');
                currentMineralField.labels.set('workerCount', currentMineralField.labels.get('workerCount') - 1);
              }
            }
          } else {
            return;
          }
        } else {
          worker.labels.delete('mineralField');
        }
      } else {
        const neediestMineralField = getNeediestMineralField(units, mineralFields);
        if (neediestMineralField) {
          const unitCommand = gather(resources, worker, neediestMineralField, false);
          collectedActions.push(unitCommand);
          worker.labels.set('mineralField', neediestMineralField);
          neediestMineralField.labels.set('workerCount', neediestMineralField.labels.get('workerCount') + 1);
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

/**
 * 
 * @param {UnitResource} units 
 * @param {"minerals" | "vespene" | undefined} type 
 * @returns 
 */
function getGatheringWorkers(units, type, firstOrderOnly = false) {
  const gatheringWorkers = units.getWorkers()
    .filter(worker => {
      return (
        worker.isGathering(type) ||
        (worker['pendingOrders'] && worker['pendingOrders'].some((/** @type {SC2APIProtocol.UnitOrder} */ order) => gatheringAbilities.includes(order.abilityId)))
      );
    });
  if (firstOrderOnly) {
    return gatheringWorkers.filter(worker => {
      const { orders } = worker; if (orders === undefined) return false;
      const firstOrder = orders[0];
      const { abilityId } = firstOrder; if (abilityId === undefined) return false;
      return gatheringAbilities.includes(abilityId);
    });
  }
  return gatheringWorkers;
}

/**
 * @param {UnitResource} units
 * @param {Unit[]} mineralFields
 * @returns {Unit | undefined}
 */
function getLeastNeediestMineralField(units, mineralFields) {
  const mineralFieldCounts = getMineralFieldAssignments(units, mineralFields)
    .filter(mineralFieldAssignments => mineralFieldAssignments.count <= 2 && mineralFieldAssignments.targetedCount <= 2)
    .sort((a, b) => {
      const { mineralContents: aContents } = a;
      const { mineralContents: bContents } = b;
      if (aContents === undefined || bContents === undefined) return 0;
      return aContents - bContents;
    }).sort((a, b) => b.count - a.count);
  if (mineralFieldCounts.length > 0) {
    const [mineralFieldCount] = mineralFieldCounts;
    const { mineralFieldTag } = mineralFieldCount;
    if (mineralFieldTag) {
      return units.getByTag(mineralFieldTag);
    }
  }
}