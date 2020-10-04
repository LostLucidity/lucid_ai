//@ts-check
"use strict"

const { avgPoints, distance } = require("@node-sc2/core/utils/geometry/point");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { Alliance } = require("@node-sc2/core/constants/enums");


module.exports = {
  defenseSetup: async (data, resources, state, defenseType) => {
    const {
      map,
      units,
    } = resources.get();
    const collectedActions = [];
    if (state.enemyBuildType === 'cheese') {
      const buildAbilityId = data.getUnitTypeData(defenseType).abilityId;
      if ((units.getById(defenseType).length + units.withCurrentOrders(buildAbilityId)) < 1 ) {
        const natural = map.getNatural();
        const naturalWall = natural.getWall();
        const midWallPosition = avgPoints(naturalWall);
        // const [ closestStructure ] = units.getClosest(avg, units.getStructures(), 1);
        // const midPoint = avgPoints([avg, closestStructure.pos]);
        // // const points = gridsInCircle(midPoint, 6.5);
        // // const filteredPoints = points.filter(point => {
        // //   return (
        // //     distance(avg, point) > 3.25 &&
        // //     distance(natural.townhallPosition, point) > 3.25
        // //   );
        // // });
        // // pick 10 random positions from the list
        // const randomPositions = filteredPoints
        //   .map(pos => ({ pos, rand: Math.random() }))
        //   .sort((a, b) => a.rand - b.rand)
        //   .map(a => a.pos)
        //   .slice(0, 20);
        // see if any of them are good    
        // const foundPosition = await actions.canPlace(defenseType, randomPositions);
        const builders = [
          ...units.getMineralWorkers(),
          ...units.getWorkers().filter(w => w.noQueue),
          ...units.withLabel('builder').filter(w => !w.isConstructing()),
        ];
        const [ builder ] = units.getClosest(midWallPosition, builders);
        if (builder) {
          const unitCommand = {
            abilityId: buildAbilityId,
            unitTags: [builder.tag],
            targetWorldSpacePos: midWallPosition,
          };
          collectedActions.push(unitCommand);
        }
      }
    }
    return collectedActions;
  },
  checkEnemyBuild: (resources, state) => {
    const {
      frame,
      map,
    } = resources.get();
    if (
      frame.timeInSeconds() > 134
      && frame.timeInSeconds() <= 240
    ) {
      if (!map.getEnemyNatural().getBase()) {
        state.enemyBuildType = 'cheese';
      }
    }
  }
}