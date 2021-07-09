//@ts-check
"use strict"

const Ability = require('@node-sc2/core/constants/ability');
const { MOVE } = require('@node-sc2/core/constants/ability');
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { constructionAbilities } = require('@node-sc2/core/constants/groups');
const { PROBE, ZERGLING } = require('@node-sc2/core/constants/unit-type');
const { distance } = require('@node-sc2/core/utils/geometry/point');
const { frontOfGrid } = require('@node-sc2/core/utils/map/region');
const { countTypes } = require('./helper/groups');
const trackUnitsService = require('./systems/track-units/track-units-service');

module.exports = {
  checkBuildingCount: ({ agent, data, resources }, unitType, targetCount) => {
    const { units } = resources.get();
    const buildAbilityId = data.getUnitTypeData(unitType).abilityId;
    let count = units.withCurrentOrders(buildAbilityId).length;
    const unitTypes = countTypes.get(unitType) ? countTypes.get(unitType) : [unitType];
    unitTypes.forEach(type => {
      let unitsToCount = units.getById(type);
      if (agent.race === Race.TERRAN) {
        unitsToCount = unitsToCount.filter(unit => unit.buildProgress >= 1);
      }
      count += unitsToCount.length;
    });
    return count === targetCount;
  },
  checkUnitCount: ({ data, resources }, unitType, targetCount) => {
    const { units } = resources.get();
    const orders = [];
    let abilityId = data.getUnitTypeData(unitType).abilityId;
    units.withCurrentOrders(abilityId).forEach(unit => {
      unit.orders.forEach(order => { if (order.abilityId === abilityId) { orders.push(order); } });
    });
    const unitCount = units.getById(unitType).length + orders.length + trackUnitsService.missingUnits.filter(unit => unit.unitType === unitType).length;
    return unitCount === targetCount;
  },
  findSupplyPositions: (resources) => {
    const { map } = resources.get();
    const myExpansions = map.getOccupiedExpansions(Alliance.SELF);
    // front of natural pylon for great justice
    const naturalWall = map.getNatural().getWall();
    let possiblePlacements = frontOfGrid({ resources }, map.getNatural().areas.areaFill)
      .filter(point => naturalWall.every(wallCell => (
        (distance(wallCell, point) <= 6.5) &&
        (distance(wallCell, point) >= 3)
      )));

    if (possiblePlacements.length <= 0) {
      possiblePlacements = frontOfGrid({ resources }, map.getNatural().areas.areaFill)
        .map(point => {
          point.coverage = naturalWall.filter(wallCell => (
            (distance(wallCell, point) <= 6.5) &&
            (distance(wallCell, point) >= 1)
          )).length;
          return point;
        })
        .sort((a, b) => b.coverage - a.coverage)
        .filter((cell, i, arr) => cell.coverage === arr[0].coverage);
    }

    return possiblePlacements;
  },
  getLoadedSupply: (units) => {
    return units.getAlive(Alliance.SELF).reduce((accumulator, currentValue) => accumulator + currentValue.cargoSpaceTaken, 0);
  },
  getTrainingSupply: (world, unitTypes) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const trainingUnitTypes = [];
    unitTypes.forEach(type => {
      let abilityId = data.getUnitTypeData(type).abilityId;
      trainingUnitTypes.push(...units.withCurrentOrders(abilityId).map(() => type));
    });
    return trainingUnitTypes.reduce((accumulator, unitType) => accumulator + (unitType === ZERGLING ? 1 : data.getUnitTypeData(unitType).foodRequired), 0);
  },
  getSupply: (data, units) => {
    return units.reduce((accumulator, currentValue) => accumulator + data.getUnitTypeData(currentValue.unitType).foodRequired, 0);
  },
  workerSendOrBuild: (resources, abilityId, position) => {
    const { frame, units } = resources.get();
    const collectedActions = [];
    let builders = [
      ...units.withLabel('builder').filter(builder => getLabelledAvailable(builder)),
      ...units.withLabel('proxy').filter(proxy => getLabelledAvailable(proxy)),
    ].filter(worker => !worker.isReturning());
    console.log('builders.length', builders.length);
    if (abilityId !== MOVE || builders.length === 0) {
      builders.push(
        ...units.getWorkers().filter(worker => worker.noQueue || worker.isGathering())
      );
      console.log('builders.length', builders.length);
    }
    const [builder] = units.getClosest(position, builders);
    if (builder) {
      if (!builder.isConstructing() && !isPendingContructing(builder)) {
        console.log(frame.timeInSeconds(), `Command given: ${Object.keys(Ability).find(ability => Ability[ability] === abilityId)}, builder.tag: ${builder.tag}, builder.isAttacking(): ${builder.isAttacking()}`);
        builder.labels.set('builder', true);
        const unitCommand = {
          abilityId: abilityId,
          unitTags: [builder.tag],
          targetWorldSpacePos: position,
        };
        collectedActions.push(unitCommand);
        module.exports.setPendingOrders(builder, unitCommand);
      }
    }
    return collectedActions;
  },
  setPendingOrders: (unit, unitCommand) => {
    if (unit.pendingOrder) {
      unit.pendingOrder.push(unitCommand);
    } else {
      unit.pendingOrder = [];
    }
  },
}

function getLabelledAvailable(labelled) {
  return (!labelled.isConstructing() || (labelled.isConstructing() && labelled.unitType === PROBE)) && !labelled.isAttacking();
}

function isPendingContructing(unit) {
  return unit.pendingOrders && unit.pendingOrders.some(o => constructionAbilities.includes(o.abilityId));
}