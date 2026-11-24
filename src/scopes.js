// Which surveys a scope of work contains, and which are required. A site visit is one scope of work at one site.
// Shared by the server (visit completion) and the phone (so a visit always lists every survey).
export const SCOPES = {
  Inspection: [
    { id: 'demo-compound', title: 'Compound Inspection', need: 'required' }, { id: 'demo-structure-flight', title: 'Structure Flight Inspection', need: 'required' },
    { id: 'demo-guy-facilities', title: 'Guy Facilities Inspection', need: 'optional' }, { id: 'demo-plumb-twist', title: 'Plumb & Twist', need: 'optional' },
  ],
  'CONS-MOD': [
    { id: 'demo-consmod-prework', title: 'CONS-MOD Prework Inspection', need: 'required' }, { id: 'demo-consmod-sector', title: 'CONS-MOD Sector COP', need: 'required' }, { id: 'demo-consmod-ground', title: 'CONS-MOD Ground COP', need: 'required' },
  ],
};

/** Surveys that are not part of a scope of work but are added to a site visit when they are done alongside it (a JSA, a daily update, rigging). */
export const ADDONS = { 'demo-jsa': 'Job Safety Analysis', 'demo-daily-update': 'Daily Update', 'demo-rigging': 'Rigging Inspection' };
