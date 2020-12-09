import random, math, time

from sc2.constants import AbilityId
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
  attackable_targets = self.all_enemy_units_and_structures.filter(lambda target: attackable_target(self, unit, target) and reachable_target(self, unit, target) and not target.type_id == UnitTypeId.LARVA)
  if attackable_targets:
    target = attackable_targets.closest_to(Point2(unit.position))
    return target

def assign_damage_vs_target_and_group_health(self, unit, enemy_unit):
  if not hasattr(unit, 'total_strength'):
    grouped_units = self.units_and_structures.closer_than(16, unit.position)
    unit.my_crew = grouped_units
    calculate_group_damage_vs_target_and_group_health(self, grouped_units, unit, enemy_unit)
  if not hasattr(enemy_unit, 'total_strength'):
    grouped_units = self.all_enemy_units_and_structures.closer_than(16, enemy_unit.position)
    calculate_group_damage_vs_target_and_group_health(self, grouped_units, enemy_unit, unit)
    enemy_unit.my_crew = grouped_units    

def calculate_group_damage_vs_target_and_group_health(self, grouped_units, unit, enemy_unit):
  group_damage_vs_target = 0
  group_health = 0
  for grouped_unit in grouped_units:
    damage_vs_target = grouped_unit.calculate_damage_vs_target(enemy_unit)
    total_damage = damage_vs_target[0] * damage_vs_target[1]
    group_damage_vs_target += total_damage
    if total_damage:
      group_health += grouped_unit.health + grouped_unit.shield
  unit.group_damage_vs_target = group_damage_vs_target
  unit.group_health = group_health
  unit.total_strength = group_damage_vs_target * group_health
  found_index = next((index for (index, d) in enumerate(self.total_strength_values) if d.tag == unit.tag), -1)
  if found_index == -1:
    self.total_strength_values.append(unit)

def attackable_target(self, unit, enemy_unit):
  return unit.calculate_damage_vs_target(enemy_unit)[0] * unit.calculate_damage_vs_target(enemy_unit)[1] > 0

def burrow(self, unit, ability):
  actions = []
  closest_attackable_enemy = get_closest_attackable_enemy(self, unit)
  if hasattr(unit, 'is_retreating') and unit.is_retreating:
    if closest_attackable_enemy.movement_speed > unit.movement_speed:
      if ability in unit.abilities:
        return [ unit(ability) ]
  return actions

def reachable_target(self, unit, enemy_unit):
  if enemy_unit.is_visible:
    if not enemy_unit.is_flying:
      unit_range = unit.ground_range
    else:
      unit_range = unit.air_range
    true_range = unit_range + unit.radius + enemy_unit.radius
    position = enemy_unit.position.towards_with_random_angle(unit.position, true_range)
    return self.in_pathing_grid(position)
  else:
    return False

def set_total_strength_values(self):
  t0 = time.process_time()
  for unit in self.total_strength_values:
    all_known_units = self.all_enemy_units_and_structures + self.units_and_structures
    found_unit = all_known_units.find_by_tag(unit.tag)
    if found_unit:
      found_unit.total_strength = unit.total_strength
      found_unit.group_damage_vs_target = unit.group_damage_vs_target
      found_unit.group_health = unit.group_health
  if self.iteration % 32 == 0:
    print('set_total_strength_values time', time.process_time() - t0)
  time_elapse = time.process_time() - t0
  self.decide_action_iteration = iteration_adjuster(time_elapse)

async def train_or_research(self, unit_type_id, ability):
  actions = []
  actions.extend(train_from_unit(self, unit_type_id, ability))
  if actions:
    return actions
  else:
    idle_structures = self.structures(unit_type_id).ready.idle
    idle_structures.extend(idle_structures.filter(lambda structure: structure.has_reactor and len(structure.orders) < 2))
    if idle_structures:
      idle_structure = random.choice(idle_structures)
      if ability in idle_structure.abilities:
        if unit_type_id == UnitTypeId.WARPGATE:
          position = get_warpin_position(self)
          if position:
            placement = await self.find_placement(ability, position, placement_step=1)
            actions.extend([ idle_structure(ability, placement)])
        else: 
          actions.extend([ idle_structure(ability)])
  return actions

def train_from_unit(self, unit_type_id, ability):
  units = self.units_and_structures(unit_type_id)
  if units:
    unit = random.choice(units)
    if ability in unit.abilities:
      return [ unit(ability) ]
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

def get_best_target_in_range(self, unit, _range=None):
  in_range_units = []
  for enemy_unit_or_structure in self.enemy_units_and_structures:
    if not enemy_unit_or_structure.type_id == UnitTypeId.LARVA:
      if not _range:
        _range = get_attack_range(unit)
      if _range + unit.radius + enemy_unit_or_structure.radius >= unit.distance_to(enemy_unit_or_structure.position):
        damage_vs_target = unit.calculate_damage_vs_target(enemy_unit_or_structure)
        total_damage = damage_vs_target[0] * damage_vs_target[1]
        enemy_health_plus_shield = enemy_unit_or_structure.health + enemy_unit_or_structure.shield
        if enemy_health_plus_shield:
          enemy_unit_or_structure.health_plus_shield_damage_ratio = total_damage / enemy_health_plus_shield
          in_range_units.append(enemy_unit_or_structure)
  if in_range_units:
    return max(in_range_units, key=lambda _unit: _unit.health_plus_shield_damage_ratio)

def get_attack_range(unit):
  if unit.ground_range > unit.air_range:
    return unit.ground_range
  else:
    return unit.air_range


def iteration_adjuster(time_elapse):
  new_iteration = int(round(time_elapse / 8 * 22.4 )) * 2
  return new_iteration if new_iteration else 1

async def try_placement_ranges(self, to_build, near_position, ability, unit=None):
  placement_step_range = range(6, 1, -1)  
  for step in placement_step_range:
    position = await self.find_placement(to_build, near_position, 28, True, step)
    if position:
      if unit:
        return [unit(ability, position)]
      else:
        worker = self.select_build_worker(position, True)
        return [worker(ability, position)]
  return []

def closest_enemy_in_range(self, unit):
  if self.enemy_units_and_structures:
    enemy_units = self.enemy_units_and_structures.filter(lambda enemy_unit: can_attack(enemy_unit, unit))
    if enemy_units:
      closest_enemy = enemy_units.closest_to(unit)
      # check for unit type
      if unit.is_flying:
        closest_enemy.range = closest_enemy.air_range
      else:
        closest_enemy.range = closest_enemy.ground_range
      if unit.position.distance_to(closest_enemy) <= closest_enemy.range + closest_enemy.radius + unit.radius:
        return closest_enemy

def get_larger_sight_range(unit, enemy_unit):
  true_sight_range = unit.sight_range + unit.radius + enemy_unit.radius
  true_enemy_sight_range = enemy_unit.sight_range + enemy_unit.radius + unit.radius
  return true_sight_range if true_sight_range > true_enemy_sight_range else true_enemy_sight_range

def get_warpin_position(self):
  # closest pylon to strongest ally
  filtered_units = self.units.filter(lambda _unit: hasattr(_unit, 'total_strength') and _unit.total_strength)
  if filtered_units:
    strongest_ally = max(filtered_units, key=lambda _unit: _unit.total_strength)
    if strongest_ally:
      closest_pylon = get_closest_unit(self, strongest_ally, self.structures(UnitTypeId.PYLON))
      if closest_pylon:
        return closest_pylon.position.towards(strongest_ally)

def lift_building(self, unit, ability):
  if ability in unit.abilities:
    if closest_enemy_in_range(self, unit):
      return [ unit(ability) ]
  return []

def stim(self, unit, ability):
  if ability in unit.abilities:
    return [ unit(ability) ]
  return []

def worker_decisions(self, unit, closest_attackable_enemy):
  actions = []
  current_distance = unit.position.distance_to(closest_attackable_enemy)
  larger_sight_range = get_larger_sight_range(unit, closest_attackable_enemy)
  true_ground_range = unit.ground_range + unit.radius + closest_attackable_enemy.radius
  true_enemy_ground_range = closest_attackable_enemy.ground_range + closest_attackable_enemy.radius + unit.radius
  larger_ground_range = true_ground_range if true_ground_range > true_enemy_ground_range else true_enemy_ground_range
  if current_distance <= larger_ground_range and unit.can_attack:
    actions += micro_units(self, unit, closest_attackable_enemy, current_distance)
  if current_distance < larger_sight_range and current_distance > larger_ground_range:
    actions += attack_or_regroup(self, unit, closest_attackable_enemy, larger_sight_range)
  return actions

def micro_units(self, unit, enemy_unit, current_distance):
  actions = []
  in_range_enemy = get_range(self, unit)
  if can_attack(in_range_enemy, unit): 
    enemy_range = in_range_enemy.ground_range + in_range_enemy.radius + unit.radius
    unit_range = unit.ground_range + unit.radius + enemy_unit.radius
    larger_sight_range = unit.sight_range if unit.sight_range > enemy_unit.sight_range else enemy_unit.sight_range
    speed = unit.movement_speed
    # enemy_speed = enemy_unit.movement_speed
    enemy_speed = in_range_enemy.movement_speed
    closest_ally = get_closest_unit(self, unit, self.units_and_structures, enemy_unit.sight_range)
    closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
    if larger_sight_range > current_distance:
      if unit_range > enemy_range:
        if current_distance > unit_range:
          if speed >= enemy_speed:
            actions += attack(self, unit)
          if speed < enemy_speed:
            attack_or_regroup(self, unit, enemy_unit, larger_sight_range)
        if current_distance == unit_range:
          actions += attack(self, unit)
        if current_distance < unit_range:
          actions += micro(self, unit, closest_ally, enemy_unit)
        if current_distance <= enemy_range + 1:
          if speed > enemy_speed:
            actions += retreat(self, unit, enemy_unit, larger_sight_range)
          if speed == enemy_speed:
            actions += retreat(self, unit, enemy_unit, larger_sight_range)
          if speed < enemy_speed:
            actions += micro(self, unit, closest_ally, enemy_unit)
      elif unit_range == enemy_range:
        if current_distance > unit_range:
          actions += attack_or_regroup(self, unit, enemy_unit, larger_sight_range)
        if current_distance <= unit_range:
          if speed > enemy_speed:
            assign_damage_vs_target_and_group_health(self, unit, enemy_unit)
            if unit.group_damage_vs_target * unit.group_health > enemy_unit.group_damage_vs_target * enemy_unit.group_health:
              actions += micro(self, unit, closest_ally, enemy_unit)
            else:
              actions += retreat(self, unit, enemy_unit, larger_sight_range)
          if speed == enemy_speed:
            assign_damage_vs_target_and_group_health(self, unit, enemy_unit)     
            if unit.group_damage_vs_target * unit.group_health > enemy_unit.group_damage_vs_target * enemy_unit.group_health:
              actions += micro(self, unit, closest_ally, enemy_unit)
            else:
              actions += retreat(self, unit, enemy_unit, larger_sight_range)
          if speed < enemy_speed:
            actions += micro(self, unit, closest_ally, enemy_unit)
      elif unit_range < enemy_range:
        if current_distance > enemy_range:
          actions += attack_or_regroup(self, unit, enemy_unit, larger_sight_range)
        if current_distance <= enemy_range:
          if current_distance > unit_range:
            if speed > enemy_speed:
              actions += attack_or_regroup(self, unit, enemy_unit, larger_sight_range)
            if speed == enemy_speed:
              actions += attack_or_regroup(self, unit, enemy_unit, larger_sight_range)
            if speed < enemy_speed:
              actions += micro(self, unit, closest_enemy, enemy_unit)
          if current_distance <= unit_range:
            if speed > enemy_speed:
              actions += attack_or_regroup(self, unit, enemy_unit, larger_sight_range)
            if speed == enemy_speed:
              actions += attack_or_regroup(self, unit, enemy_unit, larger_sight_range)
            if speed < enemy_speed:
              actions += micro(self, unit, closest_enemy, enemy_unit)
  return actions

def attack_or_regroup(self, unit, enemy_unit, _range):
  assign_damage_vs_target_and_group_health(self, unit, enemy_unit)
  higher_total_strength = unit.group_damage_vs_target * unit.group_health > enemy_unit.group_damage_vs_target * enemy_unit.group_health
  if higher_total_strength:
    if can_attack(unit, enemy_unit):
      return attack(self, unit)
  elif enemy_unit.group_damage_vs_target:
    if unit.can_attack:
      # assign_damage_vs_target_and_group_health(self, unit, enemy_unit)
      return retreat(self, unit, enemy_unit, _range)
  return []

def attack(self, unit):
  actions = []
  if self.all_enemy_units_and_structures:
    target = get_best_target_in_range(self, unit)
    if not target:
      target = get_closest_attackable_enemy(self, unit)
    unit.is_retreating = False
    if target:
      if hasattr(unit, 'my_crew'):
        my_crew_size = len(unit.my_crew)
        if my_crew_size > 1:
          closest_ally = get_closest_unit(self, unit, self.units_that_can_attack)
          if closest_ally:
            if unit.distance_to(closest_ally) + unit.radius < math.sqrt(my_crew_size) + closest_ally.radius:
              actions += [ unit(AbilityId.ATTACK_ATTACK, target.position) ]
      else:
        actions += [ unit(AbilityId.ATTACK_ATTACK, target.position) ]
    else:
        pass
  else:
    actions += find_enemy(self, unit)
  return actions

def micro(self, unit, move_to_target, attack_target):
  actions = []
  if unit.weapon_cooldown == 0:
    actions += attack(self, unit)
  else:
    actions += [ unit(AbilityId.MOVE_MOVE, move_to_target) ]
  return actions

def retreat(self, unit, enemy_unit, _range):
  actions = []
  unit.is_retreating = True
  assign_damage_vs_target_and_group_health(self, unit, enemy_unit)
  stronger_army = self.units.filter(lambda _unit: hasattr(_unit, 'total_strength') and _unit.total_strength > unit.total_strength)
  target = get_closest_unit(self, unit, stronger_army, _range)
  closest_bunker = get_closest_unit(self, unit, self.units(UnitTypeId.BUNKER))
  closest_command_center = get_closest_unit(self, unit, self.units(UnitTypeId.COMMANDCENTER))
  if closest_bunker and closest_bunker.distance_to(unit) < unit.sight_range:
    if unit.type_id in [UnitTypeId.SCV, UnitTypeId.MARINES, UnitTypeId.REAPER, UnitTypeId.MARAUDER]:
      ability = AbilityId.LOAD_BUNKER
      if ability in unit.abilities:
        return [ closest_bunker(ability, unit) ]
  if closest_command_center and closest_command_center.distance_to(unit) < unit.sight_range:
    if unit.type_id in [UnitTypeId.SCV]:
      ability = AbilityId.LOADALL_COMMANDCENTER
      if ability in unit.abilities:
        return [ closest_command_center(ability, unit) ]
  if not target:
    target = get_closest_unit(self, unit, self.units_that_can_attack, _range)
    if not target:
      target = get_closest_unit(self, unit, self.structures, _range)
      if not target:
        target = get_closest_unit(self, unit, self.units_and_structures, _range)
        if not target:
          return attack(self, unit)
  actions += [ unit(AbilityId.MOVE_MOVE, target.position) ]
  return actions

def find_enemy(self, unit):
  actions = []
   # if scout finds nothing at that location, search another 
  if unit.position.distance_to(self.scout_targets[0]) < 5:
    self.scout_targets.append(self.scout_targets.pop(0))
    self.enemy_target = self.scout_targets[0]
    actions += [ unit(AbilityId.ATTACK_ATTACK, self.scout_targets[0]) ]
  return actions  