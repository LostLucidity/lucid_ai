import * as abilities from '@node-sc2/core/constants/ability';
import * as unit_types from '@node-sc2/core/constants/unit-type';
import * as upgrades from '@node-sc2/core/constants/upgrade';
import bottle from '../service-container';


export class BuildSystem implements EventReader<SystemObject> {

  name: 'main';
  type: 'agent';

  defaultOptions: {
    state: {
      defenseMode: false,
      defenseLocation: null,
      enemyBuildType: 'standard'
    }
  };
  
  async onGameStart(world: World) {
    const race = world.agent.race;
    let plan_service = bottle.container.plan_service;
    plan_service.getPlan(race);
  }

  async onStep(world: World, game_loop: number) {
    let action_service = bottle.container.build_service;

  }

  async onEnemyFirstSeen(world: World, data: Unit) {
  
  }

  async onUnitCreated(world: World, data: Unit) {

  }

  async onUnitDamaged(world: World, data: Unit) {

  }

  async onUnitIdle(world: World, data: Unit) {

  }

}

