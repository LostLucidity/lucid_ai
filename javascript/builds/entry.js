//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core")

const entry = createSystem({
  name: 'entry',
  type: 'agent',
  async onGameStart(world) {
    world.agent.race
  }
})