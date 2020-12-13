export interface ISystem {

  name: string;
  type: string;

  defaultOptions?: any;

  onGameStart: Function;
  onStep: Function;
}