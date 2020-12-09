
export interface IPlan = {

}

export interface IPlans {
  <string>: IPlan[]
}
export const plans = {
  protos: [
    {
      id: 1,
      name: 'general',
      actions: [
        {
          supply: [0, 200],
          action: 'buildWorkers',
          options: {
            controlled: true
          }
        },
        {
          supply: 14,
          action: 'build',
          options: {
            type: 'unit_types',
            unit: 'SUPPLYDEPOT',
          }
        }
      ]
    }
  ]
}