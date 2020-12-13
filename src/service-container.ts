import * as Bottle from 'bottlejs';
import ActionService from './services/action-service';
import BuildService from './services/build-service';
import PlanService from './services/plan-service';
import { BuildSystem } from './systems/build-system';

const bottle = new Bottle();


bottle.service('build_service', BuildService);
bottle.service('build_system', BuildSystem, 'build_service');
bottle.service('plan_service', PlanService);
bottle.service('action_service', ActionService, 'plan_service', 'build_service');

export default bottle;