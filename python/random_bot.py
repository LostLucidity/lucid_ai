import sc2, random

from sc2.data import Target
from sc2.position import Point2

class RandomBot(sc2.BotAI):
  async def on_step(self, iteration: int):
    if iteration == 0:
      # await self.on_first_step()
      print('Target.Unit.value', Target.Unit.value)
      print('Target.Point.value', Target.Point.value)
      print('Target.PointOrUnit.value', Target.PointOrUnit.value)
      print('Target.PointOrNone.value', Target.PointOrNone.value)
    if iteration % 30 == 0:
      await self.take_actions()

  # async def on_first_step(self):
    

  async def take_actions(self):
    own_units = self.units + self.townhalls
    units_abilities = await self.get_available_abilities(own_units)
    for index, abilities in enumerate(units_abilities):
      if abilities:
        abilities.append('No Action')
        random_ability = random.choice(abilities)
        print('random_ability', random_ability)
        if (not random_ability == 'No Action'):
          ability_target = self._game_data.abilities[random_ability.value]._proto.target
          print('ability_target', ability_target)
          if (ability_target == 1):
            print('doing', random_ability)
            self.actions.append(own_units()[index](random_ability))
          if (ability_target == 2):
            random_point = Point2(self.select_random_point())
            print('doing', random_ability, 'on', random_point)        
            self.actions.append(own_units()[index](random_ability, random_point))
          if (ability_target == 3):
            randomUnit = random.choice(self.all_units)
            print('doing', random_ability, 'on', randomUnit)
            self.actions.append(own_units()[index](random_ability, randomUnit))
          if (ability_target == 4):
            random_point_or_unit = random.choice([Point2(self.select_random_point()), random.choice(self.all_units)])
            print('doing', random_ability, 'on', random_point_or_unit)        
            self.actions.append(own_units()[index](random_ability, random_point_or_unit))
          if (ability_target == 5):
            random_point_or_none = random.choice([Point2(self.select_random_point()), None])
            print('doing', random_ability, 'on', random_point_or_none)           
            self.actions.append(own_units()[index](random_ability, random_point_or_none))

  def select_random_point(self):
    point_x = random.uniform(0, self._game_info.pathing_grid.width)
    point_y = random.uniform(0, self._game_info.pathing_grid.height)
    return (point_x, point_y)



