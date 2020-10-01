//@ts-check
"use strict"

const { SHIELDBATTERY, PYLON } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { avgPoints, distance } = require("@node-sc2/core/utils/geometry/point");
const { Race } = require('@node-sc2/core/constants/enums');

module.exports = async function defenseSetup({ agent, data, resources }, state) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  if (state.enemyBuildType === 'cheese') {
    if (agent.race === Race.PROTOSS) {
      const buildAbilityId = data.getUnitTypeData(SHIELDBATTERY).abilityId;
      if ((units.getById(SHIELDBATTERY).length + units.withCurrentOrders(buildAbilityId)) < 1 ) {
        const natural = map.getNatural();
        const naturalWall = natural.getWall();
        const avg = avgPoints(naturalWall);
        const [ closestPylon ] = units.getClosest(avg, units.getById(PYLON), 1);
        const points = gridsInCircle(closestPylon.pos, 6.5);
        const filteredPoints = points.filter(point => {
          return (
            distance(avg, point) > 3.25 &&
            distance(natural.townhallPosition, point) > 3.75
          );
        });
        // pick 10 random positions from the list
        const randomPositions = filteredPoints
          .map(pos => ({ pos, rand: Math.random() }))
          .sort((a, b) => a.rand - b.rand)
          .map(a => a.pos)
          .slice(0, 20);
        // see if any of them are good    
        const foundPosition = await actions.canPlace(SHIELDBATTERY, randomPositions);
        await actions.build(SHIELDBATTERY, foundPosition);
      }
    }
  }
}