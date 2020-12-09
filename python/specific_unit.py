import numpy as np
import random

from sc2.constants import AbilityId
from sc2.ids.unit_typeid import UnitTypeId

from basic import should_build_workers
from helper import burrow, get_closest_unit, closest_enemy_in_range, try_placement_ranges, get_closest_attackable_enemy, get_best_target_in_range, lift_building, get_larger_sight_range, stim, worker_decisions

def adept(self, unit):
  ability = AbilityId.ADEPTPHASESHIFT_ADEPTPHASESHIFT
  if ability in unit.abilities:
    closest_attackable_enemy = get_closest_attackable_enemy(self, unit)
    if closest_attackable_enemy:
      return [unit(ability, closest_attackable_enemy.position)]
  return []

def adept_phase_shift(self, unit):
  closest_ally = get_closest_unit(self, unit, self.units)
  if closest_ally and hasattr(closest_ally, 'is_retreating') and closest_ally.is_retreating:
    ability = AbilityId.CANCEL_ADEPTSHADEPHASESHIFT
    if ability in unit.abilities:
      return [ unit(ability) ]
  return []

def high_templar(self, unit):
  actions = []
  ability = AbilityId.FEEDBACK_FEEDBACK
  if ability in unit.abilities:
    in_range_units = []
    for enemy_unit_or_structure in self.enemy_units_and_structures:
      distance = enemy_unit_or_structure.distance_to(unit)
      if distance <= 9 and enemy_unit_or_structure.energy > 0:
        in_range_units.append(enemy_unit_or_structure)
    if in_range_units:
      max_energy_unit = max(in_range_units, key=lambda _unit: _unit.energy)
      return [unit(ability, max_energy_unit)]
  return actions

def observer(self, unit):
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    if unit.distance_to(closest_enemy) < unit.sight_range:
      ability = AbilityId.MORPH_SURVEILLANCEMODE
      if ability in unit.abilities:
        return [ unit(ability) ]
    closest_ally_to_enemy = get_closest_unit(self, closest_enemy, self.units_and_structures)
    if closest_ally_to_enemy:
      ability = AbilityId.MOVE_MOVE
      if ability in unit.abilities:
        return [ unit(ability, closest_ally_to_enemy.position) ]
  return []

def observer_siege_mode(self, unit):
  actions = []
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    if unit.distance_to(closest_enemy) > unit.sight_range:
      ability = AbilityId.MORPH_OBSERVERMODE
      if ability in unit.abilities:
        return [ unit(ability) ]
  return actions

def sentry(self, unit):
  closest_attackable_enemy = get_closest_attackable_enemy(self, unit)
  if closest_attackable_enemy:
    return []
  ability = AbilityId.FORCEFIELD_FORCEFIELD
  if ability in unit.abilities:
    closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
    if closest_enemy and not closest_enemy.is_flying:
      if unit.is_retreating:
        position = closest_enemy.position.towards(unit.position, 1)
      else:
        position = closest_enemy.position.towards(unit.position, -1)
      return [ unit(ability, position) ]
  return []

def warp_prism(self, unit):
  actions = []
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    closest_ally_to_enemy = get_closest_unit(self, closest_enemy, self.units_that_can_attack)
    if closest_ally_to_enemy:
      ability = AbilityId.MOVE_MOVE
      if ability in unit.abilities:
        return [ unit(ability, closest_ally_to_enemy.position) ]
  return actions

  # def zealot(self, unit):
#   battle_decision(self, unit)

def barracks(self, unit):
  actions = []
  if unit.health_max > unit.health:
    closest_scv_or_mule = get_closest_unit(self, unit, self.workers + self.units(UnitTypeId.MULE))
    if closest_scv_or_mule:
      if closest_scv_or_mule.type_id == UnitTypeId.SCV:
        ability = AbilityId.EFFECT_REPAIR_SCV
        if ability in closest_scv_or_mule.abilities:
          actions.append(closest_scv_or_mule(ability, unit))
      elif closest_scv_or_mule.type_id == UnitTypeId.MULE:
        ability = AbilityId.EFFECT_REPAIR_MULE
        if ability in closest_scv_or_mule.abilities:
          actions.append(closest_scv_or_mule(ability, unit))
  ability = AbilityId.LIFT_BARRACKS
  actions.extend(lift_building(self, unit, ability))
  return actions

async def barracks_flying(self, unit):
  actions = []
  ability = AbilityId.LAND_BARRACKS
  if ability in unit.abilities:
    if self.structures:
      near_building = random.choice(self.structures)
      if len(near_building.orders) == 0:
        actions += await try_placement_ranges(self, UnitTypeId.BARRACKS, near_building.position, ability, unit)
  return actions

def bunker(self, unit):
  if not self.units.filter(lambda unit: hasattr(unit, 'is_retreating') and unit.is_retreating):
    ability = AbilityId.EFFECT_SALVAGE
    if ability in unit.abilities:
      return [ unit(ability) ]
  return []

def factory(self, unit):
  ability = AbilityId.LIFT_FACTORY
  return lift_building(self, unit, ability)

def hellion(self, unit):
  closest_attackable_enemy = get_closest_attackable_enemy(self, unit)
  if closest_attackable_enemy and closest_attackable_enemy.type_id == UnitTypeId.OVERLORD:
    return []
  return []

def marine(self, unit):
  actions = []
  actions += stim(self, unit, AbilityId.EFFECT_STIM_MARINE)
  return actions
    

def orbital_command(self, unit):
  ability = AbilityId.CALLDOWNMULE_CALLDOWNMULE
  if should_build_workers(self):
    if ability in unit.abilities:
      # get command center with most shortage of workers
      townhall = max(self.townhalls.ready, key=lambda _unit: _unit.harvester_shortage)
      # Drop down mule to it.
      # get mineral from townhall
      local_minerals = (mineral for mineral in self.mineral_field if mineral.distance_to(townhall) <= 8)
      target_mineral = max(local_minerals, key=lambda mineral: mineral.mineral_contents, default=None)
      if target_mineral:
        return [ unit(ability, target_mineral) ]
      ability = AbilityId.LIFT_ORBITALCOMMAND
      return lift_building(self, unit, ability)
  ability = AbilityId.SCANNERSWEEP_SCAN
  if ability in unit.abilities:
    # scan out of vision enemy units.
    not_visible_enemy_units = self.all_enemy_units_and_structures.filter(lambda structure: not self.is_visible(structure))
    if not_visible_enemy_units:
      random_unit = random.choice(not_visible_enemy_units)
      return [unit(ability, random_unit.position)]
  return []

def reaper(self, unit):
  actions = []
  ability = AbilityId.KD8CHARGE_KD8CHARGE
  if ability in unit.abilities:
    closest_attackable_enemy = get_closest_attackable_enemy(self, unit)
    if closest_attackable_enemy:
      if closest_attackable_enemy.type_id == UnitTypeId.OVERLORD:
        actions.extend([])
      if unit.is_retreating:
        position = closest_attackable_enemy.position.towards(unit.position, 1)
      else:
        position = closest_attackable_enemy.position.towards(unit.position, -1)
      actions.extend([ unit(ability, position) ])
  return actions

def scv(self, unit):
  actions = []
  closest_attackable_enemy = get_closest_attackable_enemy(self, unit)
  if closest_attackable_enemy:
    actions += worker_decisions(self, unit, closest_attackable_enemy)
    if hasattr(unit, 'is_retreating') and unit.is_retreating:
      # if closest_attackable_enemy.movement_speed > unit.movement_speed:
      closest_townhall = get_closest_unit(self, unit, self.townhalls)
      if unit.distance_to(closest_townhall) < unit.sight_range:
        ability = AbilityId.LOADALL_COMMANDCENTER
        if ability in closest_townhall.abilities:
          return [ closest_townhall(ability, unit) ]
  return actions

def starport(self, unit):
  ability = AbilityId.LIFT_STARPORT
  return lift_building(self, unit, ability)

def supply_depot(self, unit):
  # if ally closer drop
  closest_ally = get_closest_unit(self, unit, self.units_and_structures)
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy and closest_ally:
    if unit.position.distance_to(closest_ally) < unit.position.distance_to(closest_enemy):
      ability = AbilityId.MORPH_SUPPLYDEPOT_LOWER
      if ability in unit.abilities:
        return [ unit(ability) ]
    else:
      ability = AbilityId.MORPH_SUPPLYDEPOT_RAISE
      if ability in unit.abilities:
        return [ unit(ability) ]
  return []

def widow_mine(self, unit):
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    if closest_enemy.distance_to(unit) <= unit.sight_range:
      ability = AbilityId.BURROWDOWN_WIDOWMINE
      if ability in unit.abilities:
        return [ unit(ability) ]
  filtered_units = self.units.filter(lambda _unit: hasattr(_unit, 'total_strength') and _unit.total_strength)
  if filtered_units:
    strongest_army_unit = max(filtered_units, key=lambda _unit: _unit.total_strength)
    if strongest_army_unit:
      ability = AbilityId.MOVE_MOVE
      if ability in unit.abilities:
        return [ unit(ability, strongest_army_unit.position) ]
  return []

def widow_mine_burrowed(self, unit):
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    if closest_enemy.distance_to(unit) > unit.sight_range:
      ability = AbilityId.BURROWUP_WIDOWMINE
      if ability in unit.abilities:
        return [ unit(ability) ]
    if closest_enemy.distance_to(unit) < unit.sight_range and unit.weapon_cooldown > 0:
      ability = AbilityId.BURROWUP_WIDOWMINE
      if ability in unit.abilities:
        return [ unit(ability) ]
  return []

def baneling(self, unit):
  actions = []
  # move to closest ally to closest enemy
  filtered_units = self.units.filter(lambda _unit: hasattr(_unit, 'total_strength') and _unit.total_strength)
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    if filtered_units:
      strongest_army_unit = max(filtered_units, key=lambda _unit: _unit.total_strength)
      if strongest_army_unit:
        if hasattr(strongest_army_unit, 'is_retreating') and strongest_army_unit.is_retreating:
          if unit.distance_to(strongest_army_unit) < unit.sight_range:
            if unit.distance_to(closest_enemy) > unit.sight_range:
              ability = AbilityId.BURROWDOWN_BANELING
              if ability in unit.abilities:
                return [ unit(ability) ]
        ability = AbilityId.MOVE_MOVE
        if ability in unit.abilities:
          return [ unit(ability, strongest_army_unit.position) ]
    if closest_enemy.is_structure:
      ability = AbilityId.BEHAVIOR_BUILDINGATTACKON
      if ability in unit.abilities:
        actions.extend([ unit(ability) ])
    else:
      ability = AbilityId.BEHAVIOR_BUILDINGATTACKOFF
      if ability in unit.abilities:
        actions.extend([ unit(ability) ])
    if closest_enemy.distance_to(unit) <= 2.2:
      ability = AbilityId.EXPLODE_EXPLODE
      if ability in unit.abilities:
        return [ unit(ability) ]
  return actions

def baneling_burrowed(self, unit):
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy and closest_enemy.distance_to(unit) <= 2.2:
    ability = AbilityId.EXPLODE_EXPLODE
    if ability in unit.abilities:
      return [ unit(ability) ]
  filtered_units = self.units.filter(lambda _unit: hasattr(_unit, 'total_strength') and _unit.total_strength)
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    if filtered_units:
      strongest_army_unit = max(filtered_units, key=lambda _unit: _unit.total_strength)
      if strongest_army_unit:
        if not hasattr(strongest_army_unit, 'is_retreating') or not strongest_army_unit.is_retreating:
          if unit.distance_to(closest_enemy) > unit.sight_range:
            ability = AbilityId.BURROWDOWN_BANELING
            if ability in unit.abilities:
              return [ unit(ability) ]
  # burrow up if no one is around
  
  return []

def drone(self, unit):
  actions = []
  closest_attackable_enemy = get_closest_attackable_enemy(self, unit)
  if closest_attackable_enemy:
    actions += worker_decisions(self, unit, closest_attackable_enemy)
    if hasattr(unit, 'is_retreating') and unit.is_retreating:
      if closest_attackable_enemy.movement_speed > unit.movement_speed:
        ability = AbilityId.BURROWDOWN_DRONE
        if ability in unit.abilities:
          return [ unit(ability) ]
  return actions

async def queen(self, unit):
  actions = []
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    creep_target = closest_enemy
  else:
    creep_target = random.choice(self.enemy_start_locations_keys)
  creep_generators = self.structures(UnitTypeId.CREEPTUMOR) + self.structures(UnitTypeId.CREEPTUMORBURROWED) + self.structures(UnitTypeId.HATCHERY)
  closest_creep_structure = get_closest_unit(self, creep_target, creep_generators)
  if closest_creep_structure:
    free_queens = self.units(UnitTypeId.QUEEN).filter(lambda queen: not hasattr(queen, 'reserved_for_task') or not queen.reserved_for_task)
    closest_queen = free_queens.closest_to(closest_creep_structure.position)
    if closest_queen.tag == unit.tag:
      ability = AbilityId.BUILD_CREEPTUMOR_QUEEN
      if ability in unit.abilities:
        if closest_creep_structure.type_id == UnitTypeId.HATCHERY:
          creep_range = 12.5
        else:
          creep_range = 10
        range_to_place = list(np.arange(creep_range, closest_creep_structure.radius, -1))
        for step in range_to_place:
          position = closest_creep_structure.position.towards_with_random_angle(creep_target.position, step)
          # if position:
          return [ unit(ability, position) ]
  # get units in range.
  for _unit in self.units_and_structures:
    hurt_units_in_range = []
    distance = _unit.distance_to(unit)
    if distance < 7 and _unit.health_percentage < 1.0 and _unit.build_progress == 1.0:
      hurt_units_in_range.append(_unit)
  if hurt_units_in_range:
    max_hurt_ally = max(hurt_units_in_range, key=lambda _unit: _unit.health_max - _unit.health)
    if max_hurt_ally:
      ability = AbilityId.TRANSFUSION_TRANSFUSION
      if ability in unit.abilities:
        return [ unit(ability, max_hurt_ally) ]
  ability = AbilityId.BURROWDOWN_QUEEN
  actions += burrow(self, unit, ability)
  return actions

def ravager(self, unit):
  actions = []
  ability = AbilityId.EFFECT_CORROSIVEBILE
  if ability in unit.abilities:
    best_target = get_best_target_in_range(self, unit, 9)
    if best_target:
      return [unit(ability, best_target.position)]
  ability = AbilityId.BURROWDOWN_RAVAGER
  actions += burrow(self, unit, ability)
  return actions

def roach(self, unit):
  actions = []
  ability = AbilityId.BURROWDOWN_ROACH
  actions += burrow(self, unit, ability)
  return actions

def spine_crawler(self, unit):
  flying_enemy = self.enemy_units_and_structures.flying
  closest_enemy = get_closest_unit(self, unit, flying_enemy)
  if closest_enemy:
    creep_target = closest_enemy
  else:
    creep_target = random.choice(self.enemy_start_locations_keys)
  creep_generators = self.structures(UnitTypeId.CREEPTUMOR) + self.structures(UnitTypeId.HATCHERY).ready
  closest_creep_structure = get_closest_unit(self, creep_target, creep_generators)
  if closest_creep_structure:
    if unit.distance_to(creep_target) > closest_creep_structure.distance_to(creep_target):
      ability = AbilityId.SPINECRAWLERUPROOT_SPINECRAWLERUPROOT
      if ability in unit.abilities:
        return [ unit(ability) ]
  return []  

async def spine_crawler_uprooted(self, unit):
  # move to closest building towards enemy.
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    creep_target = closest_enemy
  else:
    creep_target = random.choice(self.enemy_start_locations_keys)
  creep_generators = self.structures(UnitTypeId.CREEPTUMOR) + self.structures(UnitTypeId.HATCHERY).ready
  closest_creep_structure = get_closest_unit(self, creep_target, creep_generators)
  if closest_creep_structure:
    if unit.distance_to(creep_target) > closest_creep_structure.distance_to(creep_target):
      position = closest_creep_structure.position.towards(creep_target.position, 4)
      return [unit(AbilityId.MOVE_MOVE, position)]
    else:
      ability = AbilityId.SPINECRAWLERROOT_SPINECRAWLERROOT
      if ability in unit.abilities:
        return [ unit(ability, unit.position) ]
  return []

def spore_crawler(self, unit):
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    creep_target = closest_enemy
  else:
    creep_target = random.choice(self.enemy_start_locations_keys)
  creep_generators = self.structures(UnitTypeId.CREEPTUMOR) + self.structures(UnitTypeId.HATCHERY).ready
  closest_creep_structure = get_closest_unit(self, creep_target, creep_generators)
  if closest_creep_structure:
    if unit.distance_to(creep_target) > closest_creep_structure.distance_to(creep_target):
        ability = AbilityId.SPORECRAWLERUPROOT_SPORECRAWLERUPROOT
        if ability in unit.abilities:
          return [ unit(ability) ]
  return []

def spore_crawler_uprooted(self, unit):
  # move to closest building towards enemy.
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    creep_target = closest_enemy
  else:
    creep_target = random.choice(self.enemy_start_locations_keys)
  creep_generators = self.structures(UnitTypeId.CREEPTUMOR) + self.structures(UnitTypeId.HATCHERY).ready
  closest_creep_structure = get_closest_unit(self, creep_target, creep_generators)
  if closest_creep_structure:
    if unit.distance_to(creep_target) > closest_creep_structure.distance_to(creep_target):
      position = closest_creep_structure.position.towards(creep_target.position, 4)
      return [unit(AbilityId.MOVE_MOVE, position)]
    else:
      ability = AbilityId.SPORECRAWLERROOT_SPORECRAWLERROOT
      if ability in unit.abilities:
        return [ unit(ability, unit.position) ]
  return []

def zergling(self, unit):
  actions = []
  ability = AbilityId.BURROWDOWN_ZERGLING
  actions += burrow(self, unit, ability)
  return actions