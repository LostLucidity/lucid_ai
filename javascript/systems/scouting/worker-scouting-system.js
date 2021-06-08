//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const planService = require("../../services/plan-service");
const locationHelper = require("../../helper/location");
const scoutService = require("./scouting-service");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { MOVE } = require("@node-sc2/core/constants/ability");
const { UnitType } = require("@node-sc2/core/constants");

module.exports = createSystem({
  name: 'WorkerScoutSystem',
  type: 'agent',
  async onStep(world) {
    // at 17 scout with worker.
    // should worker scout be in build order or as a plan property?
    const { actions, frame, map, units } = world.resources.get()
    const collectedActions = [];
    if (frame.timeInSeconds() > 122) { scoutService.earlyScout = false }
    planService.scouts.forEach(scout => {
      let { food, targetLocationFunction, scoutType, unitType } = scout;
      unitType = UnitType[unitType]
      if (world.agent.foodUsed >= food) {
        const targetLocation = (map[targetLocationFunction] && map[targetLocationFunction]()) ? map[targetLocationFunction]().centroid : locationHelper[targetLocationFunction](map);
        let label;
        if (targetLocationFunction.includes('get')) {
          label = targetLocationFunction.replace('get', 'scout')
        } else {
          label = 'scout';
        }
        let labelledScouts = units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
        if (labelledScouts.length === 0) {
          if (scoutType && !scoutService[scoutType]) { return; }
          scoutService.setScout(units, targetLocation, unitType, label);
          labelledScouts = units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
          const [ scout ] = labelledScouts;
          if (scout && distance(scout.pos, targetLocation) > 16) {
            const unitCommand = {
              abilityId: MOVE,
              targetWorldSpacePos: targetLocation,
              unitTags: [ scout.tag ],
            }
            collectedActions.push(unitCommand);
          }
        }
      }
    });
    await actions.sendAction(collectedActions);
  }
})