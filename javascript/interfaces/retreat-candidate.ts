export interface RetreatCandidate {
  point: Point2D;
  getDistanceByPathToRetreat: number;
  getDistanceByPathToTarget: number;
  closerOrEqualThanTarget: boolean;
  safeToRetreat: boolean
}