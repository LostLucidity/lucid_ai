//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");

module.exports = createSystem({
  name: 'Logging',
  type: 'agent',
  async onStep({ resources }) {
    console.log(resources.get().frame.timeInSeconds());
  },
});