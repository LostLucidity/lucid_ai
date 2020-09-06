//@ts-check
"use strict"

const {
  constructionAbilities,
  workerTypes,
} = require("@node-sc2/core/constants/groups");

const { avgPoints } = require('@node-sc2/core/utils/geometry/point');
const { TownhallRace } = require("@node-sc2/core/constants/race-map");

let totalFoodUsed = 0;

async function workerSetup(agent, resources, newUnit, buildPoints, expansionPoints, totalFoodUsed) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  const labels = ['builder', 'prepping'];
  let position
  let unit;
  if (newUnit.isWorker()) {
    if (buildPoints.indexOf(totalFoodUsed) > -1) {
      const naturalWall = map.getNatural().getWall();
      position = avgPoints(naturalWall);
      unit = getUnit(units, labels, newUnit, position);
      if (!unit) {
        return;
      }
    } else if (expansionPoints.indexOf(totalFoodUsed) > -1) {
      const townhallTypes = TownhallRace[agent.race]
      position = map.getAvailableExpansions()[0].townhallPosition;
      unit = getUnit(units, labels, newUnit, position, townhallTypes);
    }
    if (unit) {
      await actions.move(unit, position);
    }
  }
}

function getUnit(units, labels, newUnit, position, unitTypes) {
  // if (units.withLabel(labels[0]).length > 0 && units.withLabel(labels[1]).length > 0) {
  // get closest unit with both labels as true.
  const preppedWorkers = units.getWorkers().filter(worker => worker.labels.get(labels[0]) && worker.labels.get(labels[1]));
  const [ unit ] = units.getClosest(position, preppedWorkers); 
  if (unit) {
    if (
      unit.orders.find(order => constructionAbilities.includes(order.abilityId)) ||
      (unitTypes && unitTypes.length > 0 && unitTypes.find(unitType => units.inProgress(unitType).length > 0))
    ) {
      return;
    } else {
      return unit;
    }
  } else if (workerTypes.includes(newUnit.unitType)) {
    newUnit.labels.set('builder', true);
    newUnit.labels.set('prepping', true);
    return newUnit;
  }
}

module.exports = workerSetup;