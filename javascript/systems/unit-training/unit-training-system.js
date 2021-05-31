//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Attribute } = require("@node-sc2/core/constants/enums");
const { getSupply, getTrainingSupply } = require("../../helper");
const shortOnWorkers = require("../../helper/short-on-workers");
const { enemySupply } = require("../../services/enemy-tracking-service");
const planService = require("../../services/plan-service");
const { train } = require("../execute-plan/plan-actions");
const { workersTrainingTendedTo, haveAvailableProductionUnitsFor } = require("./unit-training-service");
const unitTrainingService = require("./unit-training-service");

module.exports = createSystem({
  name: 'UnitTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    const { frame, units } = resources.get();
    const { trainingTypes } = planService;
    const inFieldSelfSupply = getSupply(data, units.getCombatUnits());
    const selfSupply = inFieldSelfSupply + getTrainingSupply(world, trainingTypes);
    const outSupplied = enemySupply > selfSupply;
    const trainUnitConditions = [
      outSupplied,
      workersTrainingTendedTo(world) && !planService.pauseBuilding,
      !shortOnWorkers(resources) && !planService.pauseBuilding,
    ];
    if (trainUnitConditions.some(condition => condition)) {
      outSupplied ? console.log(frame.timeInSeconds(), 'Scouted higher supply', selfSupply, enemySupply) : console.log('Excess minerals');
      
      const haveTechForTypes = trainingTypes.filter(type => !data.getUnitTypeData(type).attributes.includes(Attribute.STRUCTURE) && haveAvailableProductionUnitsFor(world, type) && agent.hasTechFor(type));
      let { selectedTypeToBuild } = unitTrainingService;
      unitTrainingService.selectedTypeToBuild = selectedTypeToBuild ? selectedTypeToBuild : haveTechForTypes[Math.floor(Math.random() * haveTechForTypes.length)];
      if (typeof selectedTypeToBuild == null) { await train(world, selectedTypeToBuild) }
    }
  }
});