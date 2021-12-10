//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { SIEGETANK, SIEGETANKSIEGED, MARINE, LIBERATOR, SUPPLYDEPOT, LIBERATORAG, ORBITALCOMMAND, MARAUDER, SUPPLYDEPOTLOWERED, OVERLORD, OVERSEER, OBSERVER } = require("@node-sc2/core/constants/unit-type");
const { MORPH_SIEGEMODE, MORPH_UNSIEGE, EFFECT_STIM_MARINE, MORPH_LIBERATORAGMODE, MORPH_SUPPLYDEPOT_LOWER, MORPH_SUPPLYDEPOT_RAISE, MORPH_LIBERATORAAMODE, EFFECT_CALLDOWNMULE, EFFECT_SCAN, MOVE, ATTACK_ATTACK, EFFECT_REPAIR, STOP, HARVEST_GATHER } = require("@node-sc2/core/constants/ability");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getOccupiedExpansions, getBase } = require("../expansions");
const getRandom = require("@node-sc2/core/utils/get-random");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { getInRangeUnits, calculateHealthAdjustedSupply } = require("../battle-analysis");
const { filterLabels } = require("../unit-selection");
const Ability = require("@node-sc2/core/constants/ability");
const { larvaOrEgg } = require("../groups");
const { pullWorkersToDefend } = require("../../services/army-management-service");
const { isRepairing } = require("../../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("../../services/actions-service");
const { shadowEnemy } = require("../../builds/helper");
const { retreatToExpansion } = require("../../services/resource-manager-service");

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
            const [closestMineralField] = units.getClosest(randomExpansion.townhallPosition, units.getMineralFields());
            if (closestMineralField) {
              const unitCommand = {
                abilityId: EFFECT_CALLDOWNMULE,
                targetUnitTag: closestMineralField.tag,
                unitTags: [orbitalCommand.tag],
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
          unitTags: [orbitalCommand.tag],
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
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !larvaOrEgg.includes(unit.unitType) && !(unit.isStructure()));
    units.getByType(LIBERATOR).filter(liberator => {
      let [closestEnemyUnit] = units.getClosest(liberator.pos, enemyUnits, 1);
      if (closestEnemyUnit && !closestEnemyUnit.isFlying) {
        collectedActions.push(...triggerAbilityByDistance(liberator, closestEnemyUnit.pos, '<', 10, MORPH_LIBERATORAGMODE, 'target'));
      }
    });
    units.getByType(LIBERATORAG).filter(liberator => {
      let [closestEnemyUnit] = units.getClosest(liberator.pos, enemyUnits, 1);
      if (closestEnemyUnit && !closestEnemyUnit.isFlying) {
        collectedActions.push(...triggerAbilityByDistance(liberator, closestEnemyUnit.pos, '>', 10, MORPH_LIBERATORAAMODE));
      } else if (!closestEnemyUnit) {
        const unitCommand = {
          abilityId: MORPH_LIBERATORAAMODE,
          unitTags: [liberator.tag],
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
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !larvaOrEgg.includes(unit.unitType));
    units.getByType(MARINE).filter(marine => {
      let [closestEnemyUnit] = units.getClosest(marine.pos, enemyUnits, 1);
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
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !larvaOrEgg.includes(unit.unitType));
    units.getByType(MARAUDER).filter(marauder => {
      let [closestEnemyUnit] = units.getClosest(marauder.pos, enemyUnits, 1);
      if (closestEnemyUnit) {
        if (marauder.health / marauder.healthMax === 1 && marauder.abilityAvailable(EFFECT_STIM_MARINE)) {
          collectedActions.push(...triggerAbilityByDistance(marauder, closestEnemyUnit.pos, '<', 6, EFFECT_STIM_MARINE));
        }
      }
    });
    return collectedActions;
  },
  observerBehavior: (world) => {
    const collectedActions = [];
    const { units } = world.resources.get()
    collectedActions.push(...shadowEnemy(world, units.getById(OBSERVER)));
    return collectedActions;
  },
  overlordBehavior: (world) => {
    const collectedActions = [];
    const { units } = world.resources.get()
    collectedActions.push(...shadowEnemy(world, units.getById([OVERLORD, OVERSEER])));
    return collectedActions;
  },
  /**
   * 
   * @param {ResourceManager} resources 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  supplyDepotBehavior: (resources) => {
    const { units } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    units.getById([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]).filter(depot => {
      let [closestEnemyUnit] = units.getClosest(depot.pos, enemyUnits.filter(unit => !unit.isFlying), 1);
      if (closestEnemyUnit && distance(closestEnemyUnit.pos, depot.pos) < 16) {
        collectedActions.push(createUnitCommand(MORPH_SUPPLYDEPOT_RAISE, [depot]));
      } else {
        collectedActions.push(createUnitCommand(MORPH_SUPPLYDEPOT_LOWER, [depot]));
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
      const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !larvaOrEgg.includes(unit.unitType));
      units.getByType(SIEGETANK).filter(tank => {
        let [closestEnemyUnit] = units.getClosest(tank.pos, enemyUnits, 1);
        if (closestEnemyUnit) {
          collectedActions.push(...triggerAbilityByDistance(tank, closestEnemyUnit.pos, '<', 13, MORPH_SIEGEMODE));
        }
      });
      units.getById(SIEGETANKSIEGED).filter(tank => {
        let [closestEnemyUnit] = units.getClosest(tank.pos, enemyUnits, 1);
        if (closestEnemyUnit) {
          collectedActions.push(...triggerAbilityByDistance(tank, closestEnemyUnit.pos, '>', 13, MORPH_UNSIEGE));
        }
      });
    }
    return collectedActions;
  },
  /**
   * @param {World} param0 
   * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
   */
  workerBehavior: async ({ agent, data, resources }) => {
    const { frame, units } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !larvaOrEgg.includes(unit.unitType));
    const workers = units.getById(WorkerRace[agent.race]).filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy']) && !isRepairing(unit));
    if (enemyUnits.length > 0) {
      for (const worker of workers) {
        let [closestEnemyUnit] = units.getClosest(worker.pos, enemyUnits.filter(unit => !unit.isStructure()), 1);
        if (!closestEnemyUnit) { [closestEnemyUnit] = units.getClosest(worker.pos, units.getStructures(Alliance.ENEMY), 1) }
        const distanceToClosestEnemy = distance(worker.pos, closestEnemyUnit.pos);
        if (distanceToClosestEnemy < 16) {
          const inRangeSelfCombatUnits = getInRangeUnits(worker, units.getCombatUnits(Alliance.SELF));
          const inRangeCombatSupply = calculateHealthAdjustedSupply(data, inRangeSelfCombatUnits);
          const inRangeCombatUnitsOfEnemy = getInRangeUnits(closestEnemyUnit, units.getCombatUnits(Alliance.SELF));
          const inRangeCombatUnitsOfEnemySupply = calculateHealthAdjustedSupply(data, inRangeCombatUnitsOfEnemy);
          closestEnemyUnit['inRangeUnits'] = getInRangeUnits(closestEnemyUnit, enemyUnits);
          const inRangeEnemySupply = calculateHealthAdjustedSupply(data, closestEnemyUnit['inRangeUnits']);
          const combatSupply = inRangeCombatSupply > inRangeCombatUnitsOfEnemySupply ? inRangeCombatSupply : inRangeCombatUnitsOfEnemySupply;
          if (inRangeEnemySupply > combatSupply) {
            const inRangeWorkers = getInRangeUnits(worker, workers);
            const inRangeWorkerSupply = calculateHealthAdjustedSupply(data, inRangeWorkers);
            if (inRangeEnemySupply > inRangeWorkerSupply) {
              const position = retreatToExpansion(resources, worker, closestEnemyUnit);
              const unitCommand = {
                abilityId: MOVE,
                targetWorldSpacePos: position,
                unitTags: [worker.tag],
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
                  console.log('Ignore out of build range enemy.');
                  continue;
                }
              }
              collectedActions.push(...await pullWorkersToDefend({ agent, data, resources }, worker, closestEnemyUnit, enemyUnits));
            }
          }
        }
      };
    }
    return collectedActions;
  }
}

function triggerAbilityByDistance(unit, target, operator, range, abilityId, pointType) {
  const collectedActions = [];
  if (!unit.isEnemy()) {
    const unitCommand = {};
    if (operator === '>' && distance(unit.pos, target) > range) {
      unitCommand.abilityId = abilityId;
      unitCommand.unitTags = [unit.tag];
    } else if (operator === '<' && distance(unit.pos, target) < range) {
      unitCommand.abilityId = abilityId;
      unitCommand.unitTags = [unit.tag];
    }
    if (pointType === 'target') {
      unitCommand.targetWorldSpacePos = target;
    }
    collectedActions.push(unitCommand);
  }
  return collectedActions;
}
