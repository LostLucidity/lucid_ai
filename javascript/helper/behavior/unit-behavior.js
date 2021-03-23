//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { SIEGETANK, SIEGETANKSIEGED, LARVA, MARINE, LIBERATOR, SUPPLYDEPOT, LIBERATORAG, ORBITALCOMMAND, MARAUDER, SUPPLYDEPOTLOWERED } = require("@node-sc2/core/constants/unit-type");
const { MORPH_SIEGEMODE, MORPH_UNSIEGE, EFFECT_STIM_MARINE, MORPH_LIBERATORAGMODE, MORPH_SUPPLYDEPOT_LOWER, MORPH_SUPPLYDEPOT_RAISE, MORPH_LIBERATORAAMODE, EFFECT_CALLDOWNMULE, EFFECT_SCAN, MOVE, ATTACK_ATTACK, EFFECT_REPAIR, STOP } = require("@node-sc2/core/constants/ability");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getOccupiedExpansions, getBase } = require("../expansions");
const getRandom = require("@node-sc2/core/utils/get-random");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { retreatToExpansion } = require("../../builds/helper");
const { calculateNearSupply, getInRangeUnits } = require("../battle-analysis");
const { filterLabels } = require("../unit-selection");

module.exports = {
  orbitalCommandCenterBehavior: (resources, action) => {
    const {
      units,
    } = resources.get();
    const collectedActions = [];
    const orbitalCommand = units.getById(ORBITALCOMMAND).find(n => n.energy > 50);
    if (orbitalCommand) {
      const expansions = getOccupiedExpansions(resources).filter(expansion => getBase(resources, expansion).buildProgress >= 1);
      if (expansions.length >= 0) {
        const randomExpansion = getRandom(expansions);
        if (randomExpansion) {
          if (action === EFFECT_CALLDOWNMULE) {
            const [ closestMineralField ] = units.getClosest(randomExpansion.townhallPosition, units.getMineralFields());
            if (closestMineralField) {
              const unitCommand = {
                abilityId: EFFECT_CALLDOWNMULE,
                targetUnitTag: closestMineralField.tag,
                unitTags: [ orbitalCommand.tag ],
              }
              collectedActions.push(unitCommand);
            }
          }
        }
      }
      const enemyCloakedUnits = units.getAlive(Alliance.ENEMY).filter(unit => unit.isCloaked());
      const randomCloak = enemyCloakedUnits[Math.floor(Math.random() * enemyCloakedUnits.length)];
      if (randomCloak) {
        const unitCommand = {
          abilityId: EFFECT_SCAN,
          targetWorldSpacePos: randomCloak.pos,
          unitTags: [ orbitalCommand.tag ],
        }
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
  },
  liberatorBehavior: (resources) => {
    const {
      units,
    } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA) && !(unit.isStructure()));
    units.getByType(LIBERATOR).filter(liberator => {
      let [ closestEnemyUnit ] = units.getClosest(liberator.pos, enemyUnits, 1);
      if (closestEnemyUnit && !closestEnemyUnit.isFlying) {
        collectedActions.push(...triggerAbilityByDistance(liberator, closestEnemyUnit.pos, '<', 10, MORPH_LIBERATORAGMODE, 'target'));
      }
    });
    units.getByType(LIBERATORAG).filter(liberator => {
      let [ closestEnemyUnit ] = units.getClosest(liberator.pos, enemyUnits, 1);
      if (closestEnemyUnit && !closestEnemyUnit.isFlying) {
        collectedActions.push(...triggerAbilityByDistance(liberator, closestEnemyUnit.pos, '>', 10, MORPH_LIBERATORAAMODE));
      } else if (!closestEnemyUnit) {
        const unitCommand = {
          abilityId: MORPH_LIBERATORAAMODE,
          unitTags: [ liberator.tag ],
        }
        collectedActions.push(unitCommand);
      }
    });
    return collectedActions;
  },
  marineBehavior: (resources) => {
    const {
      units,
    } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    units.getByType(MARINE).filter(marine => {
      let [ closestEnemyUnit ] = units.getClosest(marine.pos, enemyUnits, 1);
      if (closestEnemyUnit) {
        if (marine.health / marine.healthMax === 1 && marine.abilityAvailable(EFFECT_STIM_MARINE)) {     
          collectedActions.push(...triggerAbilityByDistance(marine, closestEnemyUnit.pos, '<', 5, EFFECT_STIM_MARINE));
        }
      }
    });
    return collectedActions;
  },
  marauderBehavior: (resources) => {
    const {
      units,
    } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    units.getByType(MARAUDER).filter(marauder => {
      let [ closestEnemyUnit ] = units.getClosest(marauder.pos, enemyUnits, 1);
      if (closestEnemyUnit) {
        if (marauder.health / marauder.healthMax === 1 && marauder.abilityAvailable(EFFECT_STIM_MARINE)) {     
          collectedActions.push(...triggerAbilityByDistance(marauder, closestEnemyUnit.pos, '<', 6, EFFECT_STIM_MARINE));
        }
      }
    });
    return collectedActions;
  },
  supplyDepotBehavior: (resources) => {
    const {
      units,
    } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    units.getById([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]).filter(depot => {
      const unitCommand = { unitTags: [ depot.tag ], }
      let [ closestEnemyUnit ] = units.getClosest(depot.pos, enemyUnits, 1);
      if (closestEnemyUnit && distance(closestEnemyUnit.pos, depot.pos) < 16) {
        unitCommand.abilityId = MORPH_SUPPLYDEPOT_RAISE
        collectedActions.push(unitCommand);
      } else {
        unitCommand.abilityId = MORPH_SUPPLYDEPOT_LOWER
        collectedActions.push(unitCommand);
      }
    });
    return collectedActions;
  },
  tankBehavior: (units, target) => {
    const collectedActions = [];
    // get siege tanks
    if (target) {
      units.getByType(SIEGETANK).filter(tank => {
        collectedActions.push(...triggerAbilityByDistance(tank, target, '<', 4, MORPH_SIEGEMODE));
      });
      units.getByType(SIEGETANKSIEGED).filter(tank => {
        collectedActions.push(...triggerAbilityByDistance(tank, target, '>', 4, MORPH_UNSIEGE));
      });
    } else {
      const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
      units.getByType(SIEGETANK).filter(tank => {
        let [ closestEnemyUnit ] = units.getClosest(tank.pos, enemyUnits, 1);
        if (closestEnemyUnit) {
          collectedActions.push(...triggerAbilityByDistance(tank, closestEnemyUnit.pos, '<', 13, MORPH_SIEGEMODE));
        }
      });
      units.getById(SIEGETANKSIEGED).filter(tank => {
        let [ closestEnemyUnit ] = units.getClosest(tank.pos, enemyUnits, 1);
        if (closestEnemyUnit) {
          collectedActions.push(...triggerAbilityByDistance(tank, closestEnemyUnit.pos, '>', 13, MORPH_UNSIEGE));
        }
      });
    }
    return collectedActions;
  },
  workerBehavior: ({ agent, data, resources }) => {
    const { frame, units} = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    const workers = units.getById(WorkerRace[agent.race]).filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural']) && !isRepairing(unit));
    if (enemyUnits.length > 0) {
      workers.forEach(worker => {
        let [ closestEnemyUnit ] = units.getClosest(worker.pos, enemyUnits, 1);
        const distanceToClosestEnemy = distance(worker.pos, closestEnemyUnit.pos);
        if (distanceToClosestEnemy < 16) {
          const inRangeSelfCombatUnits = getInRangeUnits(worker, units.getCombatUnits(Alliance.SELF));
          const inRangeCombatSupply = calculateNearSupply(data, inRangeSelfCombatUnits);
          const inRangeCombatUnitsOfEnemy = getInRangeUnits(closestEnemyUnit, units.getCombatUnits(Alliance.SELF));
          const inRangeCombatUnitsOfEnemySupply = calculateNearSupply(data, inRangeCombatUnitsOfEnemy);
          closestEnemyUnit.inRangeUnits = getInRangeUnits(closestEnemyUnit, enemyUnits);
          const inRangeEnemySupply = calculateNearSupply(data, closestEnemyUnit.inRangeUnits);
          const combatSupply = inRangeCombatSupply > inRangeCombatUnitsOfEnemySupply ? inRangeCombatSupply : inRangeCombatUnitsOfEnemySupply;
          if (inRangeEnemySupply > combatSupply) {
            const inRangeWorkers = getInRangeUnits(worker, workers);
            const inRangeWorkerSupply = calculateNearSupply(data, inRangeWorkers);
            if (inRangeEnemySupply > inRangeWorkerSupply) {
              const position = retreatToExpansion(resources, worker, closestEnemyUnit);
              const unitCommand = {
                abilityId: MOVE,
                targetWorldSpacePos: position,
                unitTags: [ worker.tag ],
              }
              collectedActions.push(unitCommand);
            } else {
              if (worker.labels.get('builder')) {
                const buildOnStandby = (worker.orders.length === 0 || worker.isGathering()) || worker.isConstructing();
                const moveOrder = worker.orders.find(order => order.abilityId === MOVE);
                const position = buildOnStandby ? worker.pos : (moveOrder ? moveOrder.targetWorldSpacePos : worker.pos);
                if (worker.orders.length === 0) {
                  console.log(frame.timeInSeconds(), 'No Orders');
                } else {
                  worker.orders.forEach(order => console.log(frame.timeInSeconds(), `Builder Ability: ${Object.keys(Ability).find(ability => Ability[ability] === order.abilityId)}, worker.tag: ${worker.tag}`));
                }
                if ((buildOnStandby || moveOrder) && distance(position, closestEnemyUnit.pos) > 3) {
                  return;
                }
              } 
              const amountToDefendWith = Math.ceil(inRangeEnemySupply / data.getUnitTypeData(WorkerRace[agent.race]).foodRequired);
              const defenders = units.getClosest(closestEnemyUnit.pos, workers.filter(worker => !worker.isReturning()), amountToDefendWith + 1);
              if (defenders[0]) {
                const unitCommand = {
                  abilityId: ATTACK_ATTACK,
                  targetUnitTag: closestEnemyUnit.tag,
                  unitTags: [ defenders[0].tag ],
                }
                collectedActions.push(unitCommand);  
              }
              if (defenders[1] && defenders[1].isAttacking()) {
                const unitCommand = {
                  abilityId: STOP,
                  unitTags: [ defenders[1].tag ],
                }
                collectedActions.push(unitCommand);  
              }
            } 
          } 
        }
      });
    }
    return collectedActions;
  }
}

function isRepairing(unit) {
  return unit.orders.some(order => order.abilityId === EFFECT_REPAIR);
}

function triggerAbilityByDistance(unit, target, operator, range, abilityId, pointType) {
  const collectedActions = [];
  if (!unit.isEnemy()) {
    const unitCommand = {};
    if (operator === '>' && distance(unit.pos, target) > range) {
      unitCommand.abilityId = abilityId;
      unitCommand.unitTags = [ unit.tag ];
    } else if (operator === '<' && distance(unit.pos, target) < range) {
      unitCommand.abilityId = abilityId;
      unitCommand.unitTags = [ unit.tag ];
    }
    if (pointType === 'target') {
      unitCommand.targetWorldSpacePos = target;
    }
    collectedActions.push(unitCommand);
  }
  return collectedActions;
}
