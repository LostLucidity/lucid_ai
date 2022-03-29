//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { ATTACK_ATTACK, MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const threats = require("../helper/base-threats");
const { getInRangeUnits, assessBattleField, decideEngagement } = require("../helper/battle-analysis");
const { attackWithArmy, getInRangeDestructables } = require("../helper/behavior/army-behavior");
const { getClosestUnitByPath } = require("../helper/get-closest-by-path");
const { getCombatRally } = require("../helper/location");
const { scanCloakedEnemy } = require("../helper/terran");
const fs = require('fs');
const path = require("path");
const { workerTypes, creepTumorTypes } = require("@node-sc2/core/constants/groups");
const { OVERLORD } = require("@node-sc2/core/constants/unit-type");
const { getFileName } = require("../helper/get-races");
const { larvaOrEgg } = require("../helper/groups");
const { readFromMatchup, writeToCurrent } = require("../filesystem");
const { getCombatPoint } = require("../services/resources-service");
const { retreat } = require("../services/resource-manager-service");
const { moveAwayPosition } = require("../services/position-service");

module.exports = createSystem({
  name: 'BattleManagerSystem',
  type: 'agent',
  defaultOptions: {
    state: {
      attack: false,
      defenseMode: false,
      pushMode: false,
      compositions: [],
    },
  },
  async onEnemyFirstSeen({ data, resources }) {
    const { units } = resources.get();
    if (this.state.compositions.length === 0) {
      const [ selfUnit ] = units.getAlive(Alliance.SELF);
      const [ enemyUnit ] = units.getAlive(Alliance.ENEMY);
      readFromMatchup(this.state, data, selfUnit, enemyUnit);
    }
  },
  /**
   * 
   * @param {World} world 
   */
  async onStep(world) {
    const {agent, resources} = world;
    const { actions, frame, units } = resources.get();
    const collectedActions = [];
    this.threats = threats(resources, this.state);
    this.foodUsed = agent.foodUsed;
    if (this.foodUsed < 194 && this.state.defenseMode) {
      const rallyPoint = getCombatRally(resources);
      if (rallyPoint) {
        let [ closestEnemyUnit ] = getClosestUnitByPath(resources, rallyPoint, this.threats);
        if (closestEnemyUnit) {
          const filterList = [...creepTumorTypes, ...larvaOrEgg];
          const selfFilterList = [...filterList, ...workerTypes, OVERLORD];
          const selfUnits = units.getAlive(Alliance.SELF).filter(unit => !selfFilterList.includes(unit.unitType));
          collectedActions.push(...scanCloakedEnemy(units, closestEnemyUnit, selfUnits));
          const [ combatPoint ] = getClosestUnitByPath(resources, closestEnemyUnit.pos, selfUnits, 1);
          if (combatPoint) {
            const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !filterList.includes(unit.unitType));;
            const totalMapComposition = assessBattleField(selfUnits, enemyUnits);
            const attack = decideEngagement(this.state.compositions, totalMapComposition);
            if (attack) {
              console.log(frame.timeInSeconds(), 'Defend', totalMapComposition.differential);
              const combatPoint = getCombatPoint(resources, selfUnits, closestEnemyUnit);
              if (combatPoint) {
                const combatUnits = selfUnits;
                const army = { combatPoint, combatUnits, supportUnits: [], enemyTarget: closestEnemyUnit}
                collectedActions.push(...attackWithArmy(world, army, enemyUnits));
              }
            } else {
              selfUnits.forEach(selfUnit => {
                const selfComposition = getInRangeUnits(selfUnit, selfUnits);
                const [ closestEnemyUnit ] = units.getClosest(selfUnit.pos, enemyUnits).filter(enemyUnit => distance(selfUnit.pos, enemyUnit.pos) < 16);
                if (closestEnemyUnit) {
                  closestEnemyUnit['inRangeUnits'] = getInRangeUnits(closestEnemyUnit, enemyUnits);
                  const battleComposition = assessBattleField(selfComposition, closestEnemyUnit['inRangeUnits']);
                  // const label = 'engage';
                  const engage =
                    // selfUnit.labels.get(label) ||
                    decideEngagement(this.state.compositions, battleComposition);
                  if (engage) {
                    // selfUnit.labels.set(label, true);
                    const unitCommand = {
                      abilityId: ATTACK_ATTACK,
                      targetUnitTag: closestEnemyUnit.tag,
                      unitTags: [selfUnit.tag],
                    }
                    collectedActions.push(unitCommand);
                  } else {
                    let targetWorldSpacePos;
                    const isFlying = selfUnit.isFlying;
                    if (isFlying) {
                      targetWorldSpacePos = moveAwayPosition(closestEnemyUnit.pos, selfUnit.pos);
                    } else {
                      targetWorldSpacePos = retreat(world, selfUnit, closestEnemyUnit);
                    }
                    if (targetWorldSpacePos) {
                      const unitCommand = {
                        abilityId: MOVE,
                        targetWorldSpacePos: targetWorldSpacePos,
                        unitTags: [selfUnit.tag],
                      }
                      collectedActions.push(unitCommand);
                    }
                  }
                } else {
                  if (selfUnit.unitType) {
                    const unitCommand = {
                      abilityId: ATTACK_ATTACK,
                      unitTags: [ selfUnit.tag ],
                    }
                    const destructableTag = getInRangeDestructables(units, selfUnit);
                    if (destructableTag) { unitCommand.targetUnitTag = destructableTag; }
                    else { unitCommand.targetWorldSpacePos = rallyPoint; }
                    collectedActions.push(unitCommand);
                  }
                }
              });
            }
          }
        }
      }
    }
    await actions.sendAction(collectedActions);
  },
  async onUnitDestroyed() {
    writeToCurrent(this.state)
  },
});
