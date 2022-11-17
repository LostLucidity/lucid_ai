export interface ScoutInfo {
  start: {
    food?: number;
    time?: number;
    unit?: {
      type: string;
      count: number;
    };
  };
  end: {
    food?: number;
    time?: number;
  };
  unitType: string;
  targetLocation: string;
  scoutType: string;
}