import { BuildSystem } from './build-system';

export const systems: EventReader<SystemObject>[] = [
  BuildSystem
];