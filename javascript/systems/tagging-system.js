//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");

const ActionChat_Channel = {
  BROADCAST: 1,
  TEAM: 2,
}

module.exports = createSystem({
  name: 'TaggingSystem',
  type: 'agent',
  defaultOptions: {
    stepIncrement: 8,
  },
  async onGameStart({ resources }) {
    // if no expansions
    const { actions, map } = resources.get();
    if (!map._expansions) {
      await actions.sendChat({
        channel: ActionChat_Channel.TEAM,
        message: 'Tag: no_expansions',
      });
    }
  },
});