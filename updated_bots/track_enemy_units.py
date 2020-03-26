async def check_and_remove(self, unit_tag: int):
  found_index = next((index for (index, d) in enumerate(self.out_of_vision_units) if d.tag == unit_tag), -1)
  if found_index >= 0:
    del self.out_of_vision_units[found_index]

async def scan_vision(self):
  for out_of_vision_unit in self.out_of_vision_units:
    if out_of_vision_unit.position:
      if self.is_visible(out_of_vision_unit.position):
        for enemy_unit in self.enemy_units:
          await check_and_remove(self, enemy_unit.tag)
  # for each missing enemy position, check if it is visible.
  # if visible, check against enemy_units,
  # if no enemy units in this vision, remove position.