def check_and_remove(self, unit_tag: int):
  found_index = next((index for (index, d) in enumerate(self.out_of_vision_units) if d.tag == unit_tag), -1)
  if found_index >= 0:
    del self.out_of_vision_units[found_index]

def scan_vision(self):
  for out_of_vision_unit in self.out_of_vision_units:
    if out_of_vision_unit.position:
      if self.is_visible(out_of_vision_unit.position):
        check_and_remove(self, out_of_vision_unit.tag)