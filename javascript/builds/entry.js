//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const AssemblePlan = require("../helper/assemblePlan");
const plans = require("./plans");
const { onEnemyFirstSeen, onUnitCreated } = require("./terran");

let assemblePlan = null;

const entry = createSystem({
  name: 'main',
  type: 'agent',
  defaultOptions: {
    state: {
      defenseMode: false,
      defenseLocation: null,
      enemyBuildType: 'standard',
    },
  },
  async onEnemyFirstSeen({}, seenEnemyUnit) {
    assemblePlan.onEnemyFirstSeen(seenEnemyUnit);
  },
  async onGameStart(world) {
    // get race.
    const race = world.agent.race;
    // get build
    // const plan = plans[race]['economicStalkerColossi'];
    const plan = this.getBuild(race);
    // load build
    assemblePlan = new AssemblePlan(plan);
    assemblePlan.onGameStart(world);
    this.state.enemyBuildType = 'standard';
  },
  async onStep(world) {
    await assemblePlan.onStep(world, this.state);
  },
  async onUnitCreated(world, createdUnit) {
    await assemblePlan.onUnitCreated(world, createdUnit)
  },
  async onUnitDamaged(world, damagedUnit) {
    // if unit damaged in in progrees and less than 1/3 health.
    // units.getStructures(structure => structure.health / structure.healthMax < 1 / 3);
    const totalHealthShield = damagedUnit.health + damagedUnit.shield;
    const maxHealthShield = damagedUnit.healthMax + damagedUnit.shieldMax;
    if ((totalHealthShield / maxHealthShield) < 1/3) {
      const unitCommand = {};
    }
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