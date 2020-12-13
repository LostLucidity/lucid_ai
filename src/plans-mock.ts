export const plans = {
  protoss: [
    {
      id: 1,
      name: 'general',
      actions: [
        {
          supply: [0, 200],
          system: 'build',
          action: 'workers',
          options: {
            controlled: true
          }
        },
        {
          supply: 14,
          system: 'build',
          action: 'unit',
          options: {
            type: 'unit_types',
            unit: 'SUPPLYDEPOT',
          }
        }
      ]
    }
  ]
}