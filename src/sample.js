// This JSON *is* the survey. Developers edit/paste it in the Dev tab; there is no form editor in the MVP.
export const SAMPLE_SURVEY = {
  id: 'tower-inspection',
  version: 1,
  title: 'Tower Site Inspection',
  theme: {
    primary: '#0f766e',
    background: '#f3f5f7',
    fieldFill: '#ffffff',
    headerBg: '#0b3b39',
    headerFont: '#ffffff',
    footerBg: '#ffffff',
    bodyFont: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  },
  pages: [
    {
      name: 'site',
      label: 'Site details',
      fields: [
        { name: 'siteId', type: 'text', label: 'Site ID', hint: 'e.g. TWR-4471', required: true, maxLength: 40 },
        { name: 'inspector', type: 'text', label: 'Inspector' },
        { name: 'startedAt', type: 'dateTime', label: 'Started at', default: 'now' },
        { name: 'location', type: 'geopoint', label: 'Site location' },
        {
          name: 'towerType', type: 'select_one', label: 'Tower type', required: true,
          choices: [{ value: 'guyed', label: 'Guyed' }, { value: 'monopole', label: 'Monopole' }, { value: 'selfsupport', label: 'Self-support' }],
        },
        {
          name: 'heightFt', type: 'integer', label: 'Structure height (ft)', appearance: 'stepper', default: 150,
          constraint: '${.} >= 10 and ${.} <= 2000', constraintMessage: 'Height must be between 10 and 2000 ft.',
        },
      ],
    },
    {
      name: 'condition',
      label: 'Condition',
      fields: [
        { name: 'hasDamage', type: 'select_one', label: 'Any visible damage?', required: true, choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
        { name: 'damageNotes', type: 'text', appearance: 'multiline', label: 'Describe the damage', required: true, maxLength: 500, relevant: "${hasDamage} = 'yes'" },
        {
          name: 'findings', type: 'select_multiple', label: 'Findings',
          choices: [{ value: 'corrosion', label: 'Corrosion' }, { value: 'loose', label: 'Loose hardware' }, { value: 'paint', label: 'Paint / marking' }, { value: 'lighting', label: 'Lighting outage' }],
        },
      ],
    },
    {
      name: 'photos',
      label: 'Site photos',
      fields: [
        {
          name: 'sitePhotos', type: 'image', label: 'Site photos', hint: 'Camera, gallery or screenshots — up to 500. Compressed on this device.',
          appearance: 'both', minFiles: 3, maxFiles: 500, required: true,
        },
        { name: 'photoCount', type: 'calculate', calculation: 'count(${sitePhotos})' },
      ],
    },
    {
      name: 'guys',
      label: 'Guy wires',
      fields: [
        {
          name: 'guyWires', type: 'repeat', label: 'Guy wire', addLabel: 'Add guy wire',
          fields: [
            { name: 'wireLabel', type: 'text', label: 'Label', required: true, hint: 'e.g. A-1' },
            { name: 'tension', type: 'decimal', label: 'Tension (lbf)' },
            { name: 'wirePhotos', type: 'image', label: 'Photos', minFiles: 1, maxFiles: 5, appearance: 'both' },
          ],
        },
        { name: 'summary', type: 'calculate', calculation: "concat(${siteId}, ' — ', ${photoCount}, ' photos')" },
      ],
    },
  ],
};
