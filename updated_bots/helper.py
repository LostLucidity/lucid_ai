import random, math

def select_random_point(self):
    point_x = random.uniform(0, self._game_info.pathing_grid.width)
    point_y = random.uniform(0, self._game_info.pathing_grid.height)
    return (point_x, point_y)
  
def short_on_workers(self):
  ideal_harvesters = 0
  assigned_harvesters = 0
  for townhall in self.townhalls:
    ideal_harvesters = ideal_harvesters + townhall.ideal_harvesters
    assigned_harvesters = assigned_harvesters + townhall.assigned_harvesters
  return True if ideal_harvesters >= assigned_harvesters else False

def calculate_building_amount(self, building, mineral_to_unit_build_rate):
  return math.floor(self.state.score.collection_rate_minerals / mineral_to_unit_build_rate)

