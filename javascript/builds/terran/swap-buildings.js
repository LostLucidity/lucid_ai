//@ts-check
"use strict"

const { CANCEL_QUEUE5, LIFT, LAND } = require("@node-sc2/core/constants/ability");

module.exports = {
  swapBuildings: async (foodTarget, actions, conditions) => {
    const firstBuildingTypes = this.units.getById(conditions[0].building).filter(building => building[conditions[0].addOn]() && building.abilityAvailable(conditions[0].liftAbility));
    const secondBuildingTypes = this.units.getById(conditions[1].building).filter(building => building.buildProgress >= 1)
    if (firstBuildingTypes.length === conditions[0].count && secondBuildingTypes.length === conditions[1].count) {
      const [ firstBuilding ] = firstBuildingTypes;
      const [ secondBuilding ] = secondBuildingTypes;
      const buildings = [ firstBuilding, secondBuilding];
      for (let step = 0; step < buildings.length; step++) {
        const building = buildings[step];
        if (building.abilityAvailable(CANCEL_QUEUE5)) {
          const unitCommand = {
            abilityId: CANCEL_QUEUE5,
            unitTags: [ building.tag ],
          }
          await actions.sendAction(unitCommand); 
        };
        await actions.do(LIFT, building.tag)
      }
      await actions.do(LAND, firstBuilding.tag, { target: secondBuilding.pos, queue: true });
      await actions.do(LAND, secondBuilding.tag, { target: firstBuilding.pos, queue: true });
    }
  }
}

// async function getBuilding(actions, conditions) {
//   const firstBuildingTypes = this.units.getById(conditions[0].building).filter(building => building[conditions[0].addOn]() && building.abilityAvailable(conditions[0].liftAbility));
//   const secondBuildingTypes = this.units.getById(conditions[1].building).filter(building => building.buildProgress >= 1)
//   if (firstBuildingTypes.length === conditions[0].count && secondBuildingTypes.length === conditions[1].count) {
//     const [ firstBuilding ] = firstBuildingTypes;
//     const [ secondBuilding ] = secondBuildingTypes;
//     const buildings = [ firstBuilding, secondBuilding];
//     for (let step = 0; step < buildings.length; step++) {
//       const building = buildings[step];
//       if (building.abilityAvailable(CANCEL_QUEUE5)) {
//         const unitCommand = {
//           abilityId: CANCEL_QUEUE5,
//           unitTags: [ building.tag ],
//         }
//         await actions.sendAction(unitCommand); 
//       };
//       await actions.do(LIFT, building.tag)
//     }
//     await actions.do(LAND, firstBuilding.tag, { target: secondBuilding.pos, queue: true });
//     await actions.do(LAND, secondBuilding.tag, { target: firstBuilding.pos, queue: true });
//   }
// }