import random, math, time

from sc2.ids.unit_typeid import UnitTypeId
from sc2.position import Point2

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

def calculate_building_amount(self, mineral_to_unit_build_rate):
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

def get_closest_attackable_enemy(self, unit):
  attackable_targets = self.all_enemy_units_and_structures.filter(lambda target: attackable_target(self, unit, target) and reachable_target(self, unit, target))
  if attackable_targets:
    target = attackable_targets.closest_to(Point2(unit.position))
    return target

def assign_damage_vs_target_and_group_health(self, unit, enemy_unit):
  if not hasattr(unit, 'total_strength'):
    grouped_units = self.units_and_structures.closer_than(16, unit.position)
    unit.my_crew = grouped_units
    calculate_group_damage_vs_target_and_group_health(grouped_units, unit, enemy_unit)
  if not hasattr(enemy_unit, 'total_strength'):
    grouped_units = self.all_enemy_units_and_structures.closer_than(16, enemy_unit.position)
    calculate_group_damage_vs_target_and_group_health(grouped_units, enemy_unit, unit)
    enemy_unit.my_crew = grouped_units    

def calculate_group_damage_vs_target_and_group_health(grouped_units, unit, enemy_unit):
  group_damage_vs_target = 0
  group_health = 0
  for grouped_unit in grouped_units:
    if grouped_unit.is_snapshot:
      something = 'something'
    damage_vs_target = grouped_unit.calculate_damage_vs_target(enemy_unit)
    total_damage = damage_vs_target[0] * damage_vs_target[1]
    group_damage_vs_target += total_damage
    if total_damage:
      group_health += grouped_unit.health + grouped_unit.shield
  unit.group_damage_vs_target = group_damage_vs_target
  unit.group_health = group_health
  unit.total_strength = group_damage_vs_target * group_health
  if not hasattr(unit, 'total_strength'):
    print('Wut')

def attackable_target(self, unit, enemy_unit):
  return unit.calculate_damage_vs_target(enemy_unit)[0] * unit.calculate_damage_vs_target(enemy_unit)[1] > 0

def reachable_target(self, unit, enemy_unit):
  true_range = unit.ground_range + unit.radius + enemy_unit.radius
  position = enemy_unit.position.towards(unit, true_range)
  return self.in_pathing_grid(position)

async def train_or_research(self, unit_type_id, ability_id):
  structures = self.structures(unit_type_id).ready
  if structures:
    structure = random.choice(structures)
    abilities = await self.get_available_abilities(structure)
    if ability_id in abilities:
      if structure.is_idle:
        return [ structure(ability_id) ]
  return []

def can_attack(unit, enemy_unit):
  damage_vs_target = unit.calculate_damage_vs_target(enemy_unit)
  if (damage_vs_target[0] * damage_vs_target[1]):
    return True
  else: 
    return False

def get_range(self, unit):
  grouped_enemy_units = self.all_enemy_units_and_structures.closer_than(17, unit.position)
  for grouped_enemy_unit in grouped_enemy_units:
    distance = grouped_enemy_unit.distance_to(Point2(unit.position))
    enemy_range = grouped_enemy_unit.ground_range + grouped_enemy_unit.radius + unit.radius
    grouped_enemy_unit.distance_difference = distance - enemy_range
  return min(grouped_enemy_units, key=lambda _unit: _unit.distance_difference)

def get_best_target_in_range(self, unit):
  in_range_units = []
  for enemy_unit_or_structure in self.enemy_units_and_structures:
    if unit.ground_range + unit.radius + enemy_unit_or_structure.radius >= unit.distance_to(enemy_unit_or_structure.position):
      damage_vs_target = unit.calculate_damage_vs_target(enemy_unit_or_structure)
      total_damage = damage_vs_target[0] * damage_vs_target[1]
      enemy_health_plus_shield = enemy_unit_or_structure.health + enemy_unit_or_structure.shield
      if enemy_health_plus_shield:
        enemy_unit_or_structure.health_plus_shield_damage_ratio = total_damage / enemy_health_plus_shield
        in_range_units.append(enemy_unit_or_structure)
  if in_range_units:
    return max(in_range_units, key=lambda _unit: _unit.health_plus_shield_damage_ratio)

def iteration_adjuster(time_elapse):
  new_iteration = int(round(time_elapse / 8 * 22.4 )) * 2
  return new_iteration if new_iteration else 1

async def try_placement_ranges(self, to_build, near_building, ability):
  placement_step_range = range(6, 1, -1)  
  for step in placement_step_range:
    position = await self.find_placement(to_build, near_building.position, 28, True, step)
    if position:
      worker = self.select_build_worker(position, True)
      return [ worker(ability, position) ]
  return []

def closest_enemy_in_range(self, unit):
  if self.enemy_units_and_structures:
    enemy_units = self.enemy_units_and_structures.filter(lambda enemy_unit: can_attack(enemy_unit, unit))
    if enemy_units:
      closest_enemy = enemy_units.closest_to(unit)
      if unit.position.distance_to(closest_enemy) <= closest_enemy.ground_range + closest_enemy.radius + unit.radius:
        return closest_enemy

def get_larger_sight_range(unit, enemy_unit):
  true_sight_range = unit.sight_range + unit.radius + enemy_unit.radius
  true_enemy_sight_rage = enemy_unit.sight_range + enemy_unit.radius + unit.radius
  return true_sight_range if true_sight_range > true_enemy_sight_rage else true_enemy_sight_rage  