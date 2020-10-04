//@ts-check
"use strict"

const { OVERLORD, OVERSEER } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { moveAway } = require("../helper");

module.exports = {
  overlordCoverage(units) {
    const collectedActions = [];
    const idleOverlords = [...units.getById(OVERLORD), ...units.getById(OVERSEER)].filter(over => over.orders.length === 0);
    if (idleOverlords.length > 0) {
      const randomOverlord = idleOverlords[Math.floor(Math.random() * idleOverlords.length)];
      const closestIdleOverlords = units.getClosest(randomOverlord.pos, idleOverlords, 2);
      if (closestIdleOverlords.length > 1) {
        const distanceToClosest = distance(randomOverlord.pos, closestIdleOverlords[1].pos);
        const overlordSightRange = randomOverlord.data().sightRange;
        if (distanceToClosest < overlordSightRange) {
          collectedActions.push(moveAway(randomOverlord, closestIdleOverlords[1]));
        }
      }
    }
    return collectedActions;
  }
}