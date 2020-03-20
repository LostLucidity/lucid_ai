import random

def worker_rush(self):
  collectedActions = []
  for worker in self.workers:
    collectedActions.append(worker.attack(self.enemy_start_locations[0]))
  return collectedActions