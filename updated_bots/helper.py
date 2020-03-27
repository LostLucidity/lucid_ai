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

def get_closest_unit(self, unit, units, _range=0):
  units_in_range = []
  for _unit in units:
    distance = _unit.distance_to(unit)
    if distance > _range:
      _unit.distance = distance
      units_in_range.append(_unit)
  if units_in_range:
    return min(units_in_range, key=lambda _unit: _unit.distance)
  return []

def assign_damage_vs_target(self, unit, enemy_unit):
  grouped_units = self.units.closer_than(16, unit.position)
  calculate_group_damage_vs_target(grouped_units, unit, enemy_unit)
  grouped_units = self.enemy_units.closer_than(16, enemy_unit.position)
  calculate_group_damage_vs_target(grouped_units, enemy_unit, unit)

def calculate_group_damage_vs_target(grouped_units, unit, enemy_unit):
  group_damage_vs_target = 0
  for grouped_unit in grouped_units:
    damage_vs_target = grouped_unit.calculate_damage_vs_target(enemy_unit)
    group_damage_vs_target += damage_vs_target[0] * damage_vs_target[1]
  unit.group_damage_vs_target = group_damage_vs_target
