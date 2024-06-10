// types.d.ts

declare module '@node-sc2/core/constants' {
  export const Ability: { [key: string]: number };
  export const Buff: { [key: string]: number };
  export const UnitType: { [key: string]: number };
  export const UnitTypeId: { [key: string]: string };
  export const Upgrade: { [key: string]: number };
  export const WarpUnitAbility: { [x: number]: number; };
}
