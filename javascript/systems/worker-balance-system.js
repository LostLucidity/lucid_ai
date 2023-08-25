//@ts-check
"use strict"

const debugDebug = require('debug')('sc2:debug:WorkerBalance');
const debugSilly = require('debug')('sc2:silly:WorkerBalance');
const { createSystem } = require('@node-sc2/core');
const { SMART, MOVE, STOP } = require('@node-sc2/core/constants/ability');
const Ability = require('@node-sc2/core/constants/ability');
const { Alliance } = require('@node-sc2/core/constants/enums');
const { gatheringAbilities, rallyWorkersAbilities } = require('@node-sc2/core/constants/groups');
const { ASSIMILATOR } = require('@node-sc2/core/constants/unit-type');
const { distance } = require('@node-sc2/core/utils/geometry/point');
const { pointsOverlap } = require('../helper/utilities');
const { createUnitCommand } = require('../services/actions-service');
const { getTimeInSeconds } = require('../services/frames-service');
const { getClosestExpansion } = require('./map-resource-system/map-resource-service');
const { gather, getClosestPathablePositionsBetweenPositions } = require('../services/resource-manager-service');
const { getPendingOrders, getBuildTimeLeft, getMovementSpeed, setPendingOrders } = require('../services/unit-service');
const { gatherOrMine } = require('./manage-resources');
const { getMineralFieldAssignments, getNeediestMineralField, getGatheringWorkers } = require('./unit-resource/unit-resource-service');
const { getDistance } = require('../services/position-service');

module.exports = createSystem({
  name: 'WorkerBalanceSystem',
  type: 'agent',
  defaultOptions: {
    stepIncrement: 16,
    state: {},
  },
  async onGameStart(world) {
    const { resources } = world;
    const collectedActions = [];
    collectedActions.push(...assignWorkers(resources));
    return collectedActions;
  },
  async onStep(world) {
    const { data, resources } = world;
    const { units, actions } = resources.get();
    const collectedActions = [];
    const gatheringWorkers = getGatheringWorkers(units);
    const townhalls = units.getBases();
    const needyTownhall = townhalls.filter(townhall => {
      if (townhall['enemyUnits']) {
        let [closestEnemyUnit] = units.getClosest(townhall.pos, townhall['enemyUnits'], 1);
        if (closestEnemyUnit) {
          return townhall['selfDPSHealth'] >= closestEnemyUnit['selfDPSHealth'];
        }
      }
      return true;
    }).find(townhall => {
      const { assignedHarvesters, buildProgress, idealHarvesters } = townhall; if (assignedHarvesters === undefined || buildProgress === undefined || idealHarvesters === undefined) { return false }
      let excessHarvesters = false;
      if (buildProgress < 1) {
        const mineralFields = units.getMineralFields().filter(field => {
          const { pos } = field; if (pos === undefined) { return false }
          const { pos: townhallPos } = townhall; if (townhallPos === undefined) { return false }
          return distance(pos, townhallPos) < 8;
        });
        excessHarvesters = assignedHarvesters < mineralFields.length * 2;
      } else {
        excessHarvesters = assignedHarvesters < idealHarvesters;
      }
      return excessHarvesters;
    });
    if (needyTownhall) {
      const possibleDonerThs = townhalls.filter(townhall => {
        const { assignedHarvesters, idealHarvesters } = townhall; if (assignedHarvesters === undefined || idealHarvesters === undefined) { return false }
        return assignedHarvesters > idealHarvesters;
      });
      // debugSilly('possible ths', possibleDonerThs.map(th => th.tag));
      const [givingTownhall] = units.getClosest(needyTownhall.pos, possibleDonerThs);

      debugSilly('possible doners', gatheringWorkers.map(worker => worker.tag));

      if (givingTownhall && gatheringWorkers.length > 0) {
        debugSilly('chosen closest th', givingTownhall.tag);
        const [donatingWorker] = units.getClosest(givingTownhall.pos, gatheringWorkers);
        const { pos } = donatingWorker; if (pos === undefined) { return }
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
          const { pos: mineralFieldPos } = mineralFieldTarget; if (mineralFieldPos === undefined) { return }
          const { buildProgress, unitType } = needyTownhall; if (buildProgress === undefined || unitType === undefined) { return }
          if (buildProgress < 1) {
            const { buildTime } = data.getUnitTypeData(unitType); if (buildTime === undefined) return false;
            const buildTimeLeft = getBuildTimeLeft(needyTownhall, buildTime, buildProgress);
            const timeToMineralField = getUnitTimeToPosition(resources, donatingWorker, mineralFieldTarget); if (timeToMineralField === undefined) return false;
            if (getTimeInSeconds(buildTimeLeft) > timeToMineralField) return false;
          }
          donatingWorker.labels.set('mineralField', mineralFieldTarget);
          if (!mineralFieldTarget.labels.has('workerCount')) {
            mineralFieldTarget.labels.set('workerCount', 1);
          } else {
            mineralFieldTarget.labels.set('workerCount', mineralFieldTarget.labels.get('workerCount') + 1);
          }
          const unitCommands = gather(resources, donatingWorker, mineralFieldTarget, false);
          collectedActions.push(...unitCommands);
          unitCommands.forEach(unitCommand => setPendingOrders(donatingWorker, unitCommand));
        } else {
          const mineralFields = units.getMineralFields();
          const [mineralFieldTarget] = units.getClosest(needyTownhall.pos, mineralFields);
          if (mineralFieldTarget) {
            donatingWorker.labels.delete('mineralField');
            const unitCommands = gather(resources, donatingWorker, mineralFieldTarget, false);
            collectedActions.push(...unitCommands);
          }
        }
      }
    }
    collectedActions.push(...redirectReturningWorkers(world));
    collectedActions.push(...assignWorkers(resources));
    collectedActions.push(...gatherOrMineIdleGroup(world));
    collectedActions.push(...stopExcessGasWorkers(world));
    await actions.sendAction(collectedActions);
  },
  async onUnitCreated(world, createdUnit) {
    const { resources } = world;
    const { actions, units } = resources.get();
    if (createdUnit.unitType === ASSIMILATOR) {
      const { pos } = createdUnit; if (pos === undefined) { return }
      const [closestWorker] = units.getClosest(pos, units.getWorkers()); if (closestWorker === undefined) { return }
      const [mineralFieldTarget] = units.getClosest(pos, units.getMineralFields()); if (mineralFieldTarget === undefined) { return }
      const unitCommands = gatherOrMine(resources, closestWorker, mineralFieldTarget);
      await actions.sendAction(unitCommands);
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
      const gatheringWorkers = getGatheringWorkers(units);
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
          const unitCommands = gather(resources, worker, neediestMineralField, false);
          collectedActions.push(...unitCommands);
          worker.labels.set('mineralField', neediestMineralField);
          neediestMineralField.labels.set('workerCount', neediestMineralField.labels.get('workerCount') + 1);
        }
      })
      const [closestExpansion] = getClosestExpansion(map, pos);
      const [closestBase] = units.getClosest(closestExpansion.townhallPosition, bases);
      if (closestBase.tag !== newBuilding.tag) return;
      const { areas } = closestExpansion; if (areas === undefined) return;
      const { areaFill } = areas;
      units.getWorkers().forEach(worker => {
        const { orders, pos: workerPos } = worker; if (orders === undefined || workerPos === undefined) return false;
        if (orders.length === 0) return false;
        const { abilityId, targetUnitTag } = orders[0]; if (abilityId === undefined) return false;
        const inExpansionRange = pointsOverlap(areaFill, [workerPos]);
        if (!inExpansionRange) return;
        const isMovingToTownhall = abilityId === MOVE && targetUnitTag === newBuilding.tag;
        if (!worker.isReturning() && !isMovingToTownhall) return;
        const unitCommand = createUnitCommand(SMART, [worker]);
        unitCommand.targetUnitTag = newBuilding.tag;
        collectedActions.push(unitCommand);
      });
    }
    if (collectedActions.length > 0) {
      await actions.sendAction(collectedActions);
    }
  },
  async onUnitIdle({ resources }, idleUnit) {
    const pendingOrders = getPendingOrders(idleUnit);
    if (idleUnit.isWorker() && idleUnit.noQueue && pendingOrders.length === 0) {
      const { actions, units } = resources.get();
      if (units.getBases(Alliance.SELF).length > 0) {
        const unitCommands = gatherOrMine(resources, idleUnit);
        if (unitCommands.length > 0) {
          return actions.sendAction(unitCommands);
        }
      }
    }
  },
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
  idleWorkers.forEach(idleWorker => {
    collectedActions.push(...gatherOrMine(resources, idleWorker));
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
  const completedBases = units.getBases({ buildProgress: 1, alliance: Alliance.SELF })
  gatheringMineralWorkers.forEach(worker => {
    const { pos } = worker;
    if (pos === undefined) return;
    const [closestBase] = units.getClosest(pos, completedBases, 1);
    if (closestBase) {
      const { pos: basePos } = closestBase; if (basePos === undefined) return;
      const [closestExpansion] = getClosestExpansion(map, basePos); if (closestExpansion === undefined) return;
      const mineralFields = units.getMineralFields().filter(mineralField => mineralField.pos && getDistance(basePos, mineralField.pos) < 14);
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
                const unitCommands = gather(resources, worker, currentMineralField, false);
                collectedActions.push(...unitCommands);
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
          const unitCommands = gather(resources, worker, neediestMineralField, false);
          collectedActions.push(...unitCommands);
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

/**
 * @param {ResourceManager} resources
 * @param {Unit} donatingWorker
 * @param {Unit} targetUnit
 * @returns {number | undefined}
 */
function getUnitTimeToPosition(resources, donatingWorker, targetUnit) {
  const { map } = resources.get();
  const { pos, radius: workerRadius } = donatingWorker; // assuming worker has radius property
  const { pos: targetPosition, radius: targetRadius } = targetUnit; // assuming targetUnit has radius property

  if (pos === undefined || targetPosition === undefined || workerRadius === undefined || targetRadius === undefined) { return }

  const closestPathablePositionBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, pos, targetPosition);
  let { distance } = closestPathablePositionBetweenPositions;

  distance = distance - targetRadius - workerRadius; // adjust distance

  const movementSpeedPerSecond = getMovementSpeed(map, donatingWorker, true);
  if (movementSpeedPerSecond === undefined) { return }

  return distance / movementSpeedPerSecond
}

/**
 * @param {World} world
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function redirectReturningWorkers(world) {
  const { data, resources } = world;
  const { map, units } = resources.get();
  const collectedActions = [];
  const townHalls = units.getBases().filter(base => base.buildProgress && base.buildProgress < 1);
  townHalls.forEach(townHall => {
    const { pos, unitType } = townHall; if (pos === undefined || unitType === undefined) return;
    const [closestExpansion] = getClosestExpansion(map, pos);
    const { areas } = closestExpansion; if (areas === undefined) return;
    const { areaFill } = areas;
    const returningWorkersInTownHallRange = units.getWorkers().filter(worker => {
      const { pos: workerPos } = worker; if (workerPos === undefined) return false;
      const inExpansionRange = pointsOverlap(areaFill, [workerPos]);
      if (!worker.isReturning() || !inExpansionRange) return false;
      return true;
    });
    returningWorkersInTownHallRange.forEach(worker => {
      const { orders } = worker; if (orders === undefined) return;
      const { buildTime } = data.getUnitTypeData(unitType); if (buildTime === undefined) return;
      const { buildProgress } = townHall; if (buildProgress === undefined) return;
      const buildTimeLeft = getBuildTimeLeft(townHall, buildTime, buildProgress);
      const timeToPosition = getUnitTimeToPosition(resources, worker, townHall); if (timeToPosition === undefined) return;
      if (getTimeInSeconds(buildTimeLeft) < timeToPosition) {
        if (orders[0].targetUnitTag !== townHall.tag) {
          const unitCommand = createUnitCommand(SMART, [worker]);
          unitCommand.targetUnitTag = townHall.tag;
          collectedActions.push(unitCommand);
        }
      }
    });
  });
  return collectedActions;
}

/**
 * @param {World} world
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function stopExcessGasWorkers(world) {
  const { resources } = world;
  const { units } = resources.get();
  const collectedActions = [];
  units.getGasMines().forEach(mine => {
    const { assignedHarvesters, idealHarvesters } = mine;
    if (assignedHarvesters === undefined || idealHarvesters === undefined) return;
    const excessWorkersCount = assignedHarvesters - idealHarvesters;
    if (excessWorkersCount > 0) {
      const workersAssignedToMine = units.getWorkers().filter(worker =>
        worker.orders && worker.orders.length > 0 && worker.orders[0].targetUnitTag === mine.tag
      );
      const excessWorkers = workersAssignedToMine.slice(0, excessWorkersCount);
      excessWorkers.forEach(worker => {
        const unitCommand = createUnitCommand(STOP, [worker]);
        collectedActions.push(unitCommand);
      });
    }
  });
  return collectedActions;
}
