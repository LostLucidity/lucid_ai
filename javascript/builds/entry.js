//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { CANCEL_BUILDINPROGRESS } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const AssemblePlan = require("../helper/assemblePlan");
const plans = require("./plans");

let assemblePlan = null;
let longestTime = 0;

const entry = createSystem({
  name: 'main',
  type: 'agent',
  defaultOptions: {
    state: {
      defenseMode: false,
      defenseLocation: null,
      enemyBuildType: 'standard',
      cancelPush: false,
      pushMode: false,
    },
  },
  async onEnemyFirstSeen({}, seenEnemyUnit) {
    assemblePlan.onEnemyFirstSeen(seenEnemyUnit);
  },
  async onGameStart(world) {
    const { frame } = world.resources.get();
    console.log('frame.getGameInfo().playerInfo', frame.getGameInfo().playerInfo);
    // get race.
    const race = world.agent.race;
    // get build
    // const plan = plans[race]['economicStalkerColossi'];
    const plan = this.getBuild(race);
    // load build
    assemblePlan = new AssemblePlan(plan);
    assemblePlan.onGameStart(world);
  },
  async onStep(world) {
    const t0 = new Date().getTime();
    await assemblePlan.onStep(world, this.state);
    const t1 = new Date().getTime();
    longestTime = (t1 - t0) > longestTime ? t1 - t0 : longestTime;
    console.log(`Call to assemblePlan.onStep took ${t1 - t0} milliseconds. Longest Time ${longestTime}`);
  },
  async onUnitCreated(world, createdUnit) {
    await assemblePlan.onUnitCreated(world, createdUnit)
    if (createdUnit.isWorker()) {
      const { actions } = world.resources.get();
      return actions.gather(createdUnit);
    }
  },
  async onUnitDamaged({ resources }, damagedUnit) {
    const { actions } = resources.get();
    // if unit damaged in in progrees and less than 1/3 health.
    // units.getStructures(structure => structure.health / structure.healthMax < 1 / 3);
    const totalHealthShield = damagedUnit.health + damagedUnit.shield;
    const maxHealthShield = damagedUnit.healthMax + damagedUnit.shieldMax;
    if ((totalHealthShield / maxHealthShield) < 1/3) {
      if (damagedUnit.isStructure() && damagedUnit.buildProgress < 1) {
        const unitCommand = {
          abilityId: CANCEL_BUILDINPROGRESS,
          unitTags: [ damagedUnit.tag ],
        };
        actions.sendAction(unitCommand);
      }
    }
  },
  async onUnitDestroyed({}, destroyedUnit) {
    await assemblePlan.onUnitDestroyed(destroyedUnit);
  },
  async onUnitIdle(world, idleUnit) {
    if (idleUnit.isWorker()) {
      const { units } = world.resources.get();
      if (units.getBases(Alliance.SELF).length > 0) {
        const { actions } = world.resources.get();
        return actions.gather(idleUnit);
      }
    }
  },
  getBuild(race) {
    const racePlans = plans[race]
      var keys = Object.keys(racePlans);
      return racePlans[keys[ keys.length * Math.random() << 0]];
  }
});

module.exports = entry;