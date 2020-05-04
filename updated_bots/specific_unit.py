from sc2.constants import AbilityId
from sc2.ids.unit_typeid import UnitTypeId

from helper import get_closest_unit, closest_enemy_in_range, try_placement_ranges, get_closest_attackable_enemy

def adept(self, unit):
  ability = AbilityId.ADEPTPHASESHIFT_ADEPTPHASESHIFT
  if ability in unit.abilities:
    closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
    if closest_enemy:
      return [unit(ability, closest_enemy.position)]
  return []

def adept_phase_shift(self, unit):
  closest_ally = get_closest_unit(self, unit, self.units)
  if closest_ally and hasattr(closest_ally, 'is_retreating') and closest_ally.is_retreating:
    ability = AbilityId.CANCEL_ADEPTSHADEPHASESHIFT
    if ability in unit.abilities:
      return [ unit(ability) ]
  return []

def observer(self, unit):
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    closest_ally_to_enemy = get_closest_unit(self, closest_enemy, self.units_and_structures)
    if closest_ally_to_enemy:
      ability = AbilityId.MOVE
      if ability in unit.abilities:
        return [ unit(ability, closest_ally_to_enemy.position) ]
  return []

def sentry(self, unit):
  ability = AbilityId.FORCEFIELD_FORCEFIELD
  if ability in unit.abilities:
    closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
    if closest_enemy:
      if unit.is_retreating:
        position = closest_enemy.position.towards(unit.position, 1)
      else:
        position = closest_enemy.position.towards(unit.position, -1)
      return [ unit(ability, position) ]
  return []

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
  if ability in unit.abilities:
    if closest_enemy_in_range(self, unit):
      return [ unit(ability) ]
  return []

def bunker(self, unit):
  if not self.units.filter(lambda unit: hasattr(unit, 'is_retreating') and unit.is_retreating):
    ability = AbilityId.EFFECT_SALVAGE
    if ability in unit.abilities:
      return [ unit(ability) ]
  return []

def reaper(self, unit):
  ability = AbilityId.KD8CHARGE_KD8CHARGE
  if ability in unit.abilities:
    closest_attackable_enemy = get_closest_attackable_enemy(self, unit)
    if closest_attackable_enemy:
      if unit.is_retreating:
        position = closest_attackable_enemy.position.towards(unit.position, 1)
      else:
        position = closest_attackable_enemy.position.towards(unit.position, -1)
      return [ unit(ability, position) ]
  return []

def orbital_command(self, unit):
  ability = AbilityId.CALLDOWNMULE_CALLDOWNMULE
  if ability in unit.abilities:
    # get command center with most shortage of workers
    townhall = max(self.townhalls.ready, key=lambda _unit: _unit.harvester_shortage)
    # Drop down mule to it.
    # get mineral from townhall
    local_minerals = (mineral for mineral in self.mineral_field if mineral.distance_to(townhall) <= 8)
    target_mineral = max(local_minerals, key=lambda mineral: mineral.mineral_contents, default=None)
    if target_mineral:
      return [ unit(ability, target_mineral) ]
  return []

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

async def queen(self, unit):
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    on_creep_structures = self.structures.filter(lambda structure: structure.has_creep)
    closest_building_on_creep = get_closest_unit(self, closest_enemy, on_creep_structures)
    if closest_building_on_creep:
      closest_queen = get_closest_unit(self, closest_building_on_creep, self.units(UnitTypeId.QUEEN))
      if closest_queen.tag == unit.tag:
        ability = AbilityId.BUILD_CREEPTUMOR_QUEEN
        if ability in unit.abilities:
          position = closest_building_on_creep.position.towards_with_random_angle(closest_enemy.position, 2)
          return await try_placement_ranges(self, UnitTypeId.CREEPTUMOR, position, ability, unit)
  # get units in range.
  for _unit in self.units_and_structures:
    hurt_units_in_range = []
    distance = _unit.distance_to(unit)
    if distance < 7 and _unit.health_percentage < 1.0:
      hurt_units_in_range.append(_unit)
  if hurt_units_in_range:
    max_hurt_ally = max(hurt_units_in_range, key=lambda _unit: _unit.health_max - _unit.health)
    if max_hurt_ally:
      ability = AbilityId.TRANSFUSION_TRANSFUSION
      if ability in unit.abilities:
        return [ unit(ability, max_hurt_ally) ]
  return []

def roach(self, unit):
  return []

def spine_crawler(self, unit):
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    crawler_list = [UnitTypeId.SPINECRAWLER, UnitTypeId.SPINECRAWLERUPROOTED, UnitTypeId.SPORECRAWLER, UnitTypeId.SPORECRAWLERUPROOTED]
    filtered_structures = self.structures.filter(lambda structure: not structure.type_id in crawler_list and structure.has_creep)
    closest_building_to_closest_enemy = get_closest_unit(self, closest_enemy, filtered_structures)
    if closest_building_to_closest_enemy:
      if not unit.tag == closest_building_to_closest_enemy.tag:
        ability = AbilityId.SPINECRAWLERUPROOT_SPINECRAWLERUPROOT
        if ability in unit.abilities:
          return [ unit(ability) ]
  return []

async def spine_crawler_uprooted(self, unit):
  # move to closest building towards enemy.
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    crawler_list = [UnitTypeId.SPINECRAWLER, UnitTypeId.SPINECRAWLERUPROOTED, UnitTypeId.SPORECRAWLER, UnitTypeId.SPORECRAWLERUPROOTED]
    filtered_structures = self.structures.filter(lambda structure: not structure.type_id in crawler_list and structure.has_creep)
    closest_building_to_closest_enemy = get_closest_unit(self, closest_enemy, filtered_structures)
    if closest_building_to_closest_enemy:
      if unit.distance_to(closest_enemy) + 1 > closest_building_to_closest_enemy.distance_to(closest_enemy):
        position = closest_building_to_closest_enemy.position.towards_with_random_angle(closest_enemy.position, 2)
        return [unit(AbilityId.MOVE, position)]
      else:
        ability = AbilityId.SPINECRAWLERROOT_SPINECRAWLERROOT
        if ability in unit.abilities:
          if await self.can_place(UnitTypeId.SPINECRAWLER, unit.position):
            return [unit(ability, unit.position)]
          else:
            return []
  return []

def spore_crawler(self, unit):
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    crawler_list = [UnitTypeId.SPINECRAWLER, UnitTypeId.SPINECRAWLERUPROOTED, UnitTypeId.SPORECRAWLER, UnitTypeId.SPORECRAWLERUPROOTED]
    filtered_structures = self.structures.filter(lambda structure: not structure.type_id in crawler_list and structure.has_creep)
    closest_building_to_closest_enemy = get_closest_unit(self, closest_enemy, filtered_structures)
    if closest_building_to_closest_enemy:
      if not unit.tag == closest_building_to_closest_enemy.tag:
        ability = AbilityId.SPORECRAWLERUPROOT_SPORECRAWLERUPROOT
        if ability in unit.abilities:
          return [ unit(ability) ]
  return []

def spore_crawler_uprooted(self, unit):
  # move to closest building towards enemy.
  closest_enemy = get_closest_unit(self, unit, self.enemy_units_and_structures)
  if closest_enemy:
    crawler_list = [UnitTypeId.SPINECRAWLER, UnitTypeId.SPINECRAWLERUPROOTED, UnitTypeId.SPORECRAWLER, UnitTypeId.SPORECRAWLERUPROOTED]
    filtered_structures = self.structures.filter(lambda structure: not structure.type_id in crawler_list and structure.has_creep)
    closest_building_to_closest_enemy = get_closest_unit(self, closest_enemy, filtered_structures)
    if closest_building_to_closest_enemy:
      if not unit.tag == closest_building_to_closest_enemy.tag:
        position = closest_building_to_closest_enemy.position.towards(closest_enemy.position)
        return [unit(AbilityId.MOVE, position)]
      else:
        ability = AbilityId.SPORECRAWLERROOT_SPORECRAWLERROOT
        if ability in unit.abilities:
          return [ unit(ability, unit.position) ]
  return []


