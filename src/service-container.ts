import * as Bottle from 'bottlejs';
import ActionService from './services/action-service';
import BuildService from './services/build-service';
import PlanService from './services/plan-service';

const bottle = new Bottle();

bottle.service('build_service', BuildService);
bottle.service('plan_service', PlanService);
bottle.service('action_service', ActionService, 'build_service');

export default bottle;