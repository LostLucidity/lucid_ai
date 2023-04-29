export interface RetreatCandidate {
  point: Point2D;
  getDistanceByPathToRetreat: number;
  getDistanceByPathToTarget: number;
  closerOrEqualThanTarget: boolean;
  safeToRetreat: boolean,
  expansionsInPath: Point2D[];
}