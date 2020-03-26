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
  # max_result = max(units_in_range, key=lambda _unit: _unit.distance)
  # if self.iteration % 10 == 0:
  #   print('units_in_range', units_in_range)
  #   print('units_in_range[0]', units_in_range[0].distance)
  #   print('units_in_range[len(units_in_range) - 1]', units_in_range[len(units_in_range) - 1].distance)
  # print('min_result', min_result)
  # print('min_result.distance', min_result.distance)
  # print('max_result', max_result)
  # print('max_result.distance', max_result.distance)
  return []
  # return min(((unit, dist) for unit, dist in zip(self, distances)), key=lambda my_tuple: my_tuple[1])[0]
# def track_enemy_units(self):
#   for unit in self.previous_enemy_units:
#     found_index = next((index for (index, d) in enumerate(self.enemy_units) if d.tag == unit.tag), -1)
#     if found_index < 0:
#       self.missing_enemy_units.append(unit)

# async def on_unit_destroyed(self, unit_tag):
#   print('on_unit_destroyed', unit_tag)
#   print('self.missing_enemy_units', self.missing_enemy_units)
#   found_index = next((index for (index, d) in enumerate(self.missing_enemy_units) if d.tag == unit_tag), -1)
#   if found_index >= 0:
#     del self.missing_enemy_units[found_index]
