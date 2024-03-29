//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { LOAD_BUNKER, SMART, MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { BUNKER, QUEEN, LARVA } = require("@node-sc2/core/constants/unit-type");
const { tankBehavior } = require("../../helper/behavior/unit-behavior");
const { getCombatRally } = require("../../helper/location");
const armyManagementService = require("../../services/army-management-service");
const { engageOrRetreat } = require("../../services/army-management-service");

module.exports = createSystem({
  name: 'RallySystem',
  type: 'agent',
  async onStep({ data, resources }) {
    const { actions } = resources.get();
    if (!armyManagementService.defenseMode) {
      const { units } = resources.get();
      const collectedActions = [];
      const combatUnits = units.getCombatUnits().filter(unit => !unit.labels.get('harasser') && !unit.labels.get('scout'));
      let rallyPoint = getCombatRally(resources);
      if (combatUnits.length > 0) {
        if (units.getById(BUNKER).filter(bunker => bunker.buildProgress >= 1).length > 0) {
          const [bunker] = units.getById(BUNKER);
          rallyPoint = bunker.pos;
          const closestCombatUnitTags = units.getClosest(bunker.pos, combatUnits, combatUnits.length).map(unit => unit.tag);
          if (bunker.abilityAvailable(LOAD_BUNKER)) {
            const unitCommand = {
              abilityId: SMART,
              targetUnitTag: bunker.tag,
              unitTags: closestCombatUnitTags,
            }
            collectedActions.push(unitCommand);
          } else {
            const unitCommand = {
              abilityId: MOVE,
              targetWorldSpacePos: rallyPoint,
              unitTags: combatUnits.map(unit => unit.tag),
            }
            collectedActions.push(unitCommand);
          }
        } else {
          const selfUnits = [...combatUnits, ...units.getById(QUEEN)];
          const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
          collectedActions.push(...engageOrRetreat({ data, resources }, selfUnits, enemyUnits, rallyPoint));
        }
      }
      collectedActions.push(...tankBehavior(units, rallyPoint));
      await actions.sendAction(collectedActions);
    }
  }
});