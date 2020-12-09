import BuildService from "./build-service";

export default class ActionService {

  constructor(
    public build_service: BuildService
  ) {
    console.log('ActionService constructed');
    this.build_service = build_service
  }

  async ability(supply, options) {
    
  }

  async build(supply, options) {

  }

  async train(supply, options) {

  }

  async upgrade(supply, options) {

  }

  setup(world, plans) {
    
  }

  run(world, plans) {
    for(let order of plans) {
      this[order.action](order.supply, order.options);
    }
  }

}