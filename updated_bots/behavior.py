import math, time

from sc2.constants import AbilityId
from sc2.data import race_worker
from sc2.ids.unit_typeid import UnitTypeId
from sc2.position import Point2

from helper import get_closest_unit, assign_damage_vs_target_and_group_health, attackable_target, reachable_target, select_random_point, can_attack, short_on_workers, get_range, get_best_target_in_range, iteration_adjuster, get_closest_attackable_enemy, closest_enemy_in_range, get_larger_sight_range

def decide_action(self):
  t0 = time.process_time()
  actions = []
  for unit in self.units_and_structures:
    if unit.can_attack:
      if unit.type_id == UnitTypeId.BROODLING:
        actions += attack(self, unit)
      elif self.all_enemy_units_and_structures:
        closest_attackable_enemy = get_closest_attackable_enemy(self, unit)
        if closest_attackable_enemy:
          current_distance = unit.position.distance_to(closest_attackable_enemy)
          larger_sight_range = get_larger_sight_range(unit, closest_attackable_enemy)
          if not unit.type_id == race_worker[self.race]:
            if current_distance <= larger_sight_range and unit.can_attack:
              actions += micro_units(self, unit, closest_attackable_enemy, current_distance)
            if current_distance > larger_sight_range:
              actions += attack_or_regroup(self, unit, closest_attackable_enemy, larger_sight_range)
          else:
            true_ground_range = unit.ground_range + unit.radius + closest_attackable_enemy.radius
            true_enemy_ground_range = closest_attackable_enemy.ground_range + closest_attackable_enemy.radius + unit.radius
            larger_ground_range = true_ground_range if true_ground_range > true_enemy_ground_range else true_enemy_ground_range
            if current_distance <= larger_ground_range and unit.can_attack:
              actions += micro_units(self, unit, closest_attackable_enemy, current_distance)
            if current_distance < larger_sight_range and current_distance > larger_ground_range:
              actions += attack_or_regroup(self, unit, closest_attackable_enemy, larger_sight_range)
        else:
          if not unit.type_id == race_worker[self.race]:
            actions += attack(self, unit)        
      else:
        if not unit.type_id == race_worker[self.race]:
          actions += attack(self, unit)
    else:
      if unit.movement_speed:
        enemy_in_range = closest_enemy_in_range(self, unit)
        if enemy_in_range:
          larger_sight_range = get_larger_sight_range(unit, enemy_in_range)
          actions += retreat(self, unit, enemy_in_range, larger_sight_range)
      else:
        if not unit.is_ready:
          if closest_enemy_in_range(self, unit):
            actions += [ unit(AbilityId.CANCEL) ]
        else:
          actions += [ unit(AbilityId.LIFT_COMMANDCENTER) ]

  # if self.iteration % 32 == 0:
    # print('decide_action time', time.process_time() - t0)
  time_elapse = time.process_time() - t0
  self.decide_action_iteration = iteration_adjuster(time_elapse)
  return actions

def attack_or_regroup(self, unit, enemy_unit, _range):
  assign_damage_vs_target_and_group_health(self, unit, enemy_unit)
  higher_total_strength = unit.group_damage_vs_target * unit.group_health > enemy_unit.group_damage_vs_target * enemy_unit.group_health
  if higher_total_strength:
    if can_attack(unit, enemy_unit):
      return attack(self, unit)
  elif enemy_unit.group_damage_vs_target:
    if unit.can_attack:
      assign_damage_vs_target_and_group_health(self, unit, enemy_unit)
      return retreat(self, unit, enemy_unit, _range)
  return []

async def check_if_expansion_is_safe(self):
  expansion_location = await self.get_next_expansion()
  if expansion_location:
    if (self.enemy_units):
      closest_enemy = self.enemy_units.closest_to(expansion_location)
      _range = closest_enemy.ground_range + closest_enemy.radius
      if expansion_location.distance_to(closest_enemy) > _range:
        await self.expand_now()

def micro_units(self, unit, enemy_unit, current_distance):
  actions = []
  if (unit.type_id == UnitTypeId.BROODLING):
    attack(self, unit)
  in_range_enemy = get_range(self, unit)
  if can_attack(in_range_enemy, unit): 
    enemy_range = in_range_enemy.ground_range + in_range_enemy.radius + unit.radius
    unit_range = unit.ground_range + unit.radius + enemy_unit.radius
    larger_sight_range = unit.sight_range if unit.sight_range > enemy_unit.sight_range else enemy_unit.sight_range
    speed = unit.movement_speed
    enemy_speed = enemy_unit.movement_speed
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
        if current_distance <= enemy_range:
          if speed > enemy_speed:
            actions += [ unit(AbilityId.MOVE_MOVE, enemy_unit)]
          if speed == enemy_speed:
            assign_damage_vs_target_and_group_health(self, unit, enemy_unit)
            if unit.group_damage_vs_target * unit.group_health > enemy_unit.group_damage_vs_target * enemy_unit.group_health:
              actions += micro(self, unit, closest_ally, enemy_unit)
            else:
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
              actions += retreat(self, unit, enemy_unit, larger_sight_range)
          if current_distance <= unit_range:
            if speed > enemy_speed:
              actions += attack_or_regroup(self, unit, enemy_unit, larger_sight_range)
            if speed == enemy_speed:
              actions += attack_or_regroup(self, unit, enemy_unit, larger_sight_range)
            if speed < enemy_speed:
              actions += micro(self, unit, closest_enemy, enemy_unit)
  return actions

def micro(self, unit, move_to_target, attack_target):
  actions = []
  if unit.weapon_cooldown == 0:
    actions += attack(self, unit)
  else:
    actions += [ unit(AbilityId.MOVE_MOVE, move_to_target) ]
  return actions

def update_attack_and_retreat(self):
  actions = []
  attacking_units = self.units.filter(lambda unit: unit.is_attacking)
  retreating_units = self.units.filter(lambda unit: hasattr(unit, 'is_retreating') and unit.is_retreating)
  if attacking_units:
    for unit in attacking_units:
      actions += attack(self, unit)
  if retreating_units:
    for unit in retreating_units:
      closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
      _range = unit.sight_range if unit.sight_range > closest_enemy.sight_range else closest_enemy.sight_range
      actions += retreat(self, unit, closest_enemy, _range)
  return actions       

def retreat(self, unit, enemy_unit, _range):
  action = []
  unit.is_retreating = True
  assign_damage_vs_target_and_group_health(self, unit, enemy_unit)
  stronger_army = self.units.filter(lambda _unit: hasattr(_unit, 'total_strength') and _unit.total_strength > unit.total_strength)
  closest_unit_or_structure = get_closest_unit(self, unit, stronger_army, _range)
  if not closest_unit_or_structure:
    closest_unit_or_structure = get_closest_unit(self, unit, self.structures, _range)
  if closest_unit_or_structure:
    action += [ unit(AbilityId.MOVE_MOVE, closest_unit_or_structure.position) ]
  return action

async def assign_actions_to_idle(self):
  actions = []
  units = self.units.idle
  need_to_distribute = False
  for unit in units:
    if (unit.type_id == UnitTypeId.OVERLORD):
      actions += [ unit(AbilityId.MOVE_MOVE, Point2(select_random_point(self))) ]
    elif unit.type_id == race_worker[self.race] and short_on_workers(self):
      need_to_distribute = True
  if need_to_distribute:
    await self.distribute_workers()
  return actions

def attack(self, unit):
  actions = []
  if self.all_enemy_units_and_structures:
    target = get_best_target_in_range(self, unit)
    if not target:
      target = get_closest_attackable_enemy(self, unit)
    unit.is_retreating = False
    if target:
      actions += [ unit(AbilityId.ATTACK_ATTACK, target.position) ]
    else:
        pass
  else:
    actions += [ unit(AbilityId.ATTACK_ATTACK, self.enemy_start_locations[0]) ]
  return actions

def compare_combatants(self, unit, unit_type, unit_range, enemy_unit, enemy_unit_type, enemy_range):
  if (unit.type_id == unit_type and enemy_unit.type_id == enemy_unit_type):
    print(unit)
    print(unit_range)
    assign_damage_vs_target_and_group_health(self, unit, enemy_unit)
    print(unit.group_damage_vs_target * unit.group_health)
    print(enemy_unit)
    print(enemy_range)
    print(enemy_unit.group_damage_vs_target * enemy_unit.group_health)