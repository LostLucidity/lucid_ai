from sc2.constants import AbilityId
from sc2.ids.unit_typeid import UnitTypeId

from helper import get_closest_unit

def scan_surroundings(self):
  actions = []
  for unit in self.units:
    if self.enemy_units:
      closest_enemy = self.enemy_units.closest_to(unit)
      _range = closest_enemy.ground_range + 3
      if unit.position.distance_to(closest_enemy) <= _range:
        actions += attack_or_regroup(self, unit, closest_enemy, _range)
  return actions

def attack_or_regroup(self, unit, enemy_unit, _range):
  # print('unit.army_size', unit.army_size)
  # print('enemy_unit.army_size', enemy_unit.army_size)
  if unit.army_size > enemy_unit.army_size:
    # check how orders look like
    return [ unit(AbilityId.ATTACK_ATTACK, enemy_unit)]
  else:
    closest_ally = get_closest_unit(self, enemy_unit, self.units, _range)
    closest_structure = get_closest_unit(self, enemy_unit, self.structures, _range)
    if closest_ally:
      return [ unit(AbilityId.MOVE_MOVE, closest_ally.position) ]
    elif closest_structure:
      return [ unit(AbilityId.MOVE_MOVE, closest_structure.position) ]
  return []

def analyze_units(self):
  for unit in self.units:
    grouped_units = self.units.closer_than(16, unit.position)
    unit.army_size = len(grouped_units)
  for unit in self.enemy_units:
    grouped_units = self.enemy_units.closer_than(16, unit.position)
    unit.army_size = len(grouped_units)
  
# analyze groups of units for attack/defense ratio. 