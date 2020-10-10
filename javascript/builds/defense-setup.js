//@ts-check
"use strict"

const { SHIELDBATTERY, PYLON, BUNKER, SPINECRAWLER } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { avgPoints, distance } = require("@node-sc2/core/utils/geometry/point");
const { Race } = require('@node-sc2/core/constants/enums');
const canAfford = require("../helper/can-afford");

module.exports = async function defenseSetup({ agent, data, resources }, state) {
  const {
    actions,
    map,
    units,
  } = resources.get();
  if (state.enemyBuildType === 'cheese') {
    let buildAbilityId;
    switch (agent.race) {
      case Race.TERRAN:
        buildAbilityId = data.getUnitTypeData(BUNKER).abilityId;
        if ((units.getById(BUNKER).length + units.withCurrentOrders(buildAbilityId)) < 1 ) {
          const natural = map.getNatural();
          const naturalWall = natural.getWall();
          if (naturalWall) {
            const avg = avgPoints(naturalWall);
            const avgWallAndNatural = avgPoints([avg, natural.townhallPosition]);
            const nearPoints = gridsInCircle(avgWallAndNatural, 4);
            const sampledPoints = nearPoints
              .map(pos => ({ pos, rand: Math.random() }))
              .sort((a, b) => a.rand - b.rand)
              .map(a => a.pos)
              .slice(0, 20);
            const foundPosition = await actions.canPlace(BUNKER, sampledPoints);
            if (foundPosition) {
              try {
                if (canAfford(agent, data, BUNKER)) {
                  await actions.build(BUNKER, foundPosition);
                }
              } catch (error) {
                console.log(error);
              }
            }   
          }
        }
        break;
      case Race.PROTOSS:
        buildAbilityId = data.getUnitTypeData(SHIELDBATTERY).abilityId;
        if ((units.getById(SHIELDBATTERY).length + units.withCurrentOrders(buildAbilityId)) < 1 ) {
          const natural = map.getNatural();
          const naturalWall = natural.getWall();
          if (naturalWall) {
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
            if (foundPosition) {
              try {
                if (canAfford(agent, data, SHIELDBATTERY)) {
                  await actions.build(SHIELDBATTERY, foundPosition);
                }
              } catch (error) {
                console.log(error);
              }
            }
          }
        }
        break;
      case Race.ZERG:
        buildAbilityId = data.getUnitTypeData(SPINECRAWLER).abilityId;
        if ((units.getById(SPINECRAWLER).length + units.withCurrentOrders(buildAbilityId)) < 1 ) {
          const natural = map.getNatural();
          const naturalWall = natural.getWall();
          if (naturalWall) {
            const avg = avgPoints(naturalWall);
            const points = gridsInCircle(avg, 1);
            const filteredPoints = points.filter(point => {
              return (
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
            const foundPosition = await actions.canPlace(SPINECRAWLER, randomPositions);
            if (foundPosition) {
              try {
                if (canAfford(agent, data, SPINECRAWLER)) {
                  await actions.build(SPINECRAWLER, foundPosition);
                }
              } catch (error) {
                console.log(error);
              }
            }
          }
        }
        break;
    }
  }
  const [ defenseStructure ] = units.getById(state.defenseStructures);
  if (defenseStructure) {
    state.defenseLocation = defenseStructure.pos;
  }
}