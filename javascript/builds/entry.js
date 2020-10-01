//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const AssemblePlan = require("../helper/assemblePlan");
const plans = require("./protoss/plans");

let assemblePlan = null;

const entry = createSystem({
  name: 'main',
  type: 'agent',
  defaultOptions: {
    state: {
      defenseMode: false,
      enemyBuildType: 'standard',
    },
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
    assemblePlan.onStep(world, this.state);
  },
  async onUnitIdle({ resources }, idleUnit) {
    const {
      units
    } = resources.get();
    if (idleUnit.isWorker()) {
      const { actions } = resources.get();
      if (units.getBases(Alliance.SELF).length > 0) {
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