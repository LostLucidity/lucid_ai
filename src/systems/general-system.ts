import { createSystem } from '@node-sc2/core';
import ActionService from '../services/action-service';
import PlanService from '../services/plan-service';

export class GeneralSystem {

  constructor(
    protected plan_service: PlanService,
    protected action_service: ActionService
  ) {
    this.plan_service = plan_service;
    this.action_service = action_service;
  }
  
  createSystem() {
    let options = {
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
      },
      onGameStart: async(world) => {
        const race = world.agent.race;
        this.plan_service.getPlan(race);
      },
      async onStep(world) {
      },
      async onUnitCreated(world, createdUnit) {
      },
      async onUnitDamaged({ resources }, damagedUnit) {
      },
      async onUnitIdle(world, idleUnit) {
      },
    }
    return createSystem(options);
  }

}

