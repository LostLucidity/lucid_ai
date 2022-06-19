//@ts-check
"use strict"

const debugDebug = require('debug')('sc2:debug:WorkerBalance');
const debugSilly = require('debug')('sc2:silly:WorkerBalance');
const { createSystem } = require('@node-sc2/core');
const Ability = require('@node-sc2/core/constants/ability');
const { Alliance } = require('@node-sc2/core/constants/enums');
const { gatheringAbilities, rallyWorkersAbilities } = require('@node-sc2/core/constants/groups');
const { distance } = require('@node-sc2/core/utils/geometry/point');
const { getClosestExpansion } = require('../services/map-resource-service');
const planService = require('../services/plan-service');
const { getClosestUnitByPath } = require('../services/resources-service');
const { balanceResources, gatherOrMine } = require('./manage-resources');
const { gather, getMineralFieldAssignments } = require('./unit-resource/unit-resource-service');
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
    collectedActions.push(...assignWorkers(resources));
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
        const mineralFields = units.getMineralFields().filter(field => {
          return (
            (distance(field.pos, needyTownhall.pos) < 8) &&
            (!field.labels.has('workerCount') || field.labels.get('workerCount') < 2)
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
          await actions.gather(donatingWorker, mineralFieldTarget, false);
        } else {
          const mineralFields = units.getMineralFields();
          const [mineralFieldTarget] = units.getClosest(needyTownhall.pos, mineralFields);
          if (mineralFieldTarget) {
            donatingWorker.labels.delete('mineralField');
            await actions.gather(donatingWorker, mineralFieldTarget, false);
          }
        }
      }
    }
    const collectedActions = [];
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
 * @returns 
 */
function assignWorkers(resources) {
  const { map, units } = resources.get();
  const collectedActions = [];
  const gatheringMineralWorkers = getGatheringWorkers(units, 'minerals');
  // for each gathering worker, find the closest mineral field and assign it to it
  // continue until all gathering workers are assigned with a maximum of 2 workers per mineral field
  gatheringMineralWorkers.forEach(worker => {
    const [closestBase] = getClosestUnitByPath(resources, worker.pos, units.getBases());
    if (closestBase) {
      const [closestExpansion] = getClosestExpansion(map, closestBase.pos);
      const { mineralFields } = closestExpansion.cluster;
      const mineralFieldCounts = getMineralFieldAssignments(units, mineralFields)
        .filter(mineralFieldAssignments => mineralFieldAssignments.count < 2)
        .sort((a, b) => a.count - b.count);
      /** @type {Unit} */
      const assignedMineralField = worker.labels.get('mineralField');
      if (assignedMineralField) {
        // check if the current mineral field is still valid
        const currentMineralField = units.getByTag(assignedMineralField.tag);
        if (currentMineralField) {
          // check if gathering order is targeting the current mineral field
          // if gathering order is not targeting the current mineral field, order the worker to gather the current mineral field
          const gatheringOrder = findGatheringOrder(units, worker);
          if (gatheringOrder) {
            if (gatheringOrder.targetUnitTag !== currentMineralField.tag) {
              const unitCommand = gather(units, worker, currentMineralField, false);
              collectedActions.push(unitCommand);
              unitResourceService.setPendingOrders(worker, unitCommand);
            }
          }
        } else {
          // if the current mineral field is no longer valid, delete the mineral field tag from the worker
          worker.labels.delete('mineralField');
        }
      } else {
        // if the worker is not assigned to a mineral field, order the worker to gather the first mineral field
        if (mineralFieldCounts.length > 0) {
          const mineralField = mineralFieldCounts[0];
          const { mineralFieldTag } = mineralField;
          const unitCommand = gather(units, worker, units.getByTag(mineralFieldTag), false);
          collectedActions.push(unitCommand);
          unitResourceService.setPendingOrders(worker, unitCommand);
          worker.labels.set('mineralField', units.getByTag(mineralFieldTag));
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
 * @param {'minerals' | 'vespene'} type 
 * @returns 
 */
function getGatheringWorkers(units, type) {
  return units.getWorkers()
    .filter(worker => {
      return (
        worker.isGathering(type) ||
        (worker['pendingOrders'] && worker['pendingOrders'].some((/** @type {SC2APIProtocol.UnitOrder} */ order) => gatheringAbilities.includes(order.abilityId)))
      );
    });
}