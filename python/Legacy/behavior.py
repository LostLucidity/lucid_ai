import math, time

from sc2.constants import AbilityId
from sc2.data import race_worker
from sc2.ids.unit_typeid import UnitTypeId
from sc2.position import Point2

from helper import attack_or_regroup, get_closest_unit, assign_damage_vs_target_and_group_health, attackable_target, reachable_target, select_random_point, can_attack, short_on_workers, get_range, get_best_target_in_range, iteration_adjuster, get_closest_attackable_enemy, closest_enemy_in_range, get_larger_sight_range
from specific_unit import adept, adept_phase_shift, high_templar, observer, observer_siege_mode, sentry, warp_prism, barracks, barracks_flying, bunker, hellion, marine, orbital_command, reaper, supply_depot, widow_mine, widow_mine_burrowed, baneling, baneling_burrowed, drone, queen, roach, ravager, spine_crawler, spine_crawler_uprooted, spore_crawler, spore_crawler_uprooted, zergling

async def decide_action(self):
  t0 = time.process_time()
  actions = []
  for unit in self.units_and_structures:
    if unit.type_id == UnitTypeId.ADEPT:
      action = adept(self, unit)
      actions += action
      if not action:
        actions += battle_decision(self, unit)
      continue
    if unit.type_id == UnitTypeId.ADEPTPHASESHIFT:
      actions += adept_phase_shift(self, unit)
      continue
    if unit.type_id == UnitTypeId.HIGHTEMPLAR:
      action = high_templar(self, unit)
      actions += action
      if not action:
        actions += battle_decision(self, unit)
    if unit.type_id == UnitTypeId.OBSERVER:
      actions += observer(self, unit)
      continue
    if unit.type_id == UnitTypeId.OBSERVERSIEGEMODE:
      actions += observer_siege_mode(self, unit)
      continue    
    if unit.type_id == UnitTypeId.SENTRY:
      actions += battle_decision(self, unit)
      if unit.can_attack:
        actions += []
      if hasattr(unit, 'is_retreating'):
        actions += sentry(self, unit)
      continue
    if unit.type_id == UnitTypeId.STALKER:
      actions += battle_decision(self, unit)
      continue
    if unit.type_id == UnitTypeId.WARPPRISM:
      actions += warp_prism(self, unit)
      continue    
    if unit.type_id == UnitTypeId.ZEALOT:
      actions += battle_decision(self, unit)
      continue
    if unit.type_id == UnitTypeId.BARRACKS:
      actions += barracks(self, unit)
      continue
    if unit.type_id == UnitTypeId.BARRACKSFLYING:
      actions += await barracks_flying(self, unit)
      continue
    if unit.type_id == UnitTypeId.BUNKER:
      actions += bunker(self, unit)
      continue
    if unit.type_id == UnitTypeId.HELLION:
      actions += hellion(self, unit)
      actions += battle_decision(self, unit)
      continue      
    if unit.type_id == UnitTypeId.MARINE:
      actions += battle_decision(self, unit)
      actions += marine(self, unit)
      continue
    if unit.type_id == UnitTypeId.ORBITALCOMMAND:
      actions += orbital_command(self, unit)
      continue
    if unit.type_id == UnitTypeId.REAPER:
      actions += battle_decision(self, unit)
      if hasattr(unit, 'is_retreating'):
        actions += reaper(self, unit)
      continue
    if unit.type_id == UnitTypeId.SUPPLYDEPOT:
      actions += supply_depot(self, unit)
      continue
    if unit.type_id == UnitTypeId.WIDOWMINE:
      actions += widow_mine(self, unit)
      continue
    if unit.type_id == UnitTypeId.WIDOWMINEBURROWED:
      actions += widow_mine_burrowed(self, unit)
      continue
    if unit.type_id == UnitTypeId.BANELING:
      actions += baneling(self, unit)
      continue
    if unit.type_id == UnitTypeId.BANELINGBURROWED:
      actions += baneling_burrowed(self, unit)
      continue
    if unit.type_id == UnitTypeId.BROODLING:
      actions += attack(self, unit)
      continue
    if unit.type_id == UnitTypeId.DRONE:
      actions += drone(self, unit)
      continue    
    if unit.type_id == UnitTypeId.QUEEN:
      if not hasattr(unit, 'reserved_for_task') or not unit.reserved_for_task:
        action = await queen(self, unit)
        actions += action
        if not action:
          actions += battle_decision(self, unit)
      continue
    if unit.type_id == UnitTypeId.ROACH:
      actions += battle_decision(self, unit)
      continue
    if unit.type_id == UnitTypeId.RAVAGER:
      actions += ravager(self, unit)
      actions += battle_decision(self, unit)
      continue
    if unit.type_id == UnitTypeId.SPINECRAWLER:
      actions += spine_crawler(self, unit)
      continue
    if unit.type_id == UnitTypeId.SPINECRAWLERUPROOTED:
      actions += await spine_crawler_uprooted(self, unit)
      continue
    if unit.type_id == UnitTypeId.SPORECRAWLER:
      actions += spore_crawler(self, unit)
      continue
    if unit.type_id == UnitTypeId.SPORECRAWLERUPROOTED:
      actions += spore_crawler_uprooted(self, unit)
      continue
    if unit.type_id == UnitTypeId.ZERGLING:
      actions += battle_decision(self, unit)
      if hasattr(unit, 'is_retreating'):
        actions += zergling(self, unit)
      continue
    if unit.can_attack:
      if self.all_enemy_units_and_structures:
        closest_attackable_enemy = get_closest_attackable_enemy(self, unit)
        if closest_attackable_enemy:
          current_distance = unit.position.distance_to(closest_attackable_enemy)
          larger_sight_range = get_larger_sight_range(unit, closest_attackable_enemy)
          if not unit.type_id == race_worker[self.race]:
            if not hasattr(unit, 'reserved_for_task') or not unit.reserved_for_task:
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
            if not hasattr(unit, 'reserved_for_task') or not unit.reserved_for_task:
              actions += attack(self, unit)
      else:
        if not unit.type_id == race_worker[self.race]:
          if not hasattr(unit, 'reserved_for_task') or not unit.reserved_for_task:
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
          if closest_enemy_in_range(self, unit):
            actions += [ unit(AbilityId.LIFT_COMMANDCENTER) ]

  if self.iteration % 32 == 0:
    print('decide_action time', time.process_time() - t0)

  return actions

def battle_decision(self, unit):
  actions = []
  closest_attackable_enemy = get_closest_attackable_enemy(self, unit)
  if closest_attackable_enemy:
    current_distance = unit.position.distance_to(closest_attackable_enemy)
    larger_sight_range = get_larger_sight_range(unit, closest_attackable_enemy)
    if current_distance <= larger_sight_range and unit.can_attack:
      actions += micro_units(self, unit, closest_attackable_enemy, current_distance)
    elif current_distance > larger_sight_range:
      actions += attack_or_regroup(self, unit, closest_attackable_enemy, larger_sight_range)
  else:
    actions += [ unit(AbilityId.ATTACK_ATTACK, self.enemy_start_locations[0]) ]
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
        if not hasattr(unit, 'reserved_for_task') or not unit.reserved_for_task:
          actions += attack(self, unit)
  if retreating_units:
    for unit in retreating_units:
      closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
      _range = unit.sight_range if unit.sight_range > closest_enemy.sight_range else closest_enemy.sight_range
      actions += retreat(self, unit, closest_enemy, _range)
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
    actions += find_enemy(self, unit)
  return actions

def find_enemy(self, unit):
  actions = []
   # if scout finds nothing at that location, search another 
  if unit.position.distance_to(self.scout_targets[0]) < 5:
    self.scout_targets.append(self.scout_targets.pop(0))
    self.enemy_target = self.scout_targets[0]
    actions += [ unit(AbilityId.ATTACK_ATTACK, self.scout_targets[0]) ]
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