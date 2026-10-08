// Static game data shared by server and browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PData = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = ['blue', 'yellow', 'black', 'red'];
  const COLOR_HEX = { blue: '#3b7dd8', yellow: '#f2c230', black: '#555b66', red: '#d8433b' };

  // Board coordinates (stylised, roughly matching the physical board) on a 1240x660 canvas,
  // plus real lat/lon used to warp the world-map background so each city sits on its real location.
  const CITIES = {
    'San Francisco': { color: 'blue', x: 55, y: 205, lat: 37.77, lon: -122.42 },
    'Chicago': { color: 'blue', x: 165, y: 165, lat: 41.88, lon: -87.63 },
    'Montreal': { color: 'blue', x: 265, y: 150, lat: 45.5, lon: -73.57 },
    'Boston': { color: 'blue', x: 350, y: 168, lat: 42.36, lon: -71.06 },
    'Austin': { color: 'blue', x: 145, y: 252, lat: 30.27, lon: -97.74 },
    'Washington': { color: 'blue', x: 320, y: 232, lat: 38.91, lon: -77.04 },
    'London': { color: 'blue', x: 500, y: 118, lat: 51.51, lon: -0.13 },
    'Madrid': { color: 'blue', x: 485, y: 210, lat: 40.42, lon: -3.7 },
    'Paris': { color: 'blue', x: 575, y: 165, lat: 48.86, lon: 2.35 },
    'Essen': { color: 'blue', x: 590, y: 95, lat: 51.46, lon: 7.01 },
    'Milan': { color: 'blue', x: 655, y: 140, lat: 45.46, lon: 9.19 },
    'St. Petersburg': { color: 'blue', x: 705, y: 80, lat: 59.93, lon: 30.36 },

    'Los Angeles': { color: 'yellow', x: 75, y: 300, lat: 34.05, lon: -118.24 },
    'Mexico City': { color: 'yellow', x: 160, y: 330, lat: 19.43, lon: -99.13 },
    'Miami': { color: 'yellow', x: 275, y: 310, lat: 25.76, lon: -80.19 },
    'Bogota': { color: 'yellow', x: 275, y: 400, lat: 4.71, lon: -74.07 },
    'Lima': { color: 'yellow', x: 220, y: 490, lat: -12.05, lon: -77.04 },
    'Santiago': { color: 'yellow', x: 230, y: 590, lat: -33.45, lon: -70.67 },
    'Buenos Aires': { color: 'yellow', x: 345, y: 580, lat: -34.6, lon: -58.38 },
    'Sao Paulo': { color: 'yellow', x: 410, y: 500, lat: -23.55, lon: -46.63 },
    'Lagos': { color: 'yellow', x: 570, y: 385, lat: 6.52, lon: 3.38 },
    'Kinshasa': { color: 'yellow', x: 625, y: 465, lat: -4.44, lon: 15.27 },
    'Khartoum': { color: 'yellow', x: 700, y: 375, lat: 15.5, lon: 32.56 },
    'Johannesburg': { color: 'yellow', x: 690, y: 560, lat: -26.2, lon: 28.05 },

    'Algiers': { color: 'black', x: 595, y: 265, lat: 36.75, lon: 3.06 },
    'Cairo': { color: 'black', x: 670, y: 295, lat: 30.04, lon: 31.24 },
    'Istanbul': { color: 'black', x: 690, y: 215, lat: 41.01, lon: 28.98 },
    'Moscow': { color: 'black', x: 775, y: 160, lat: 55.76, lon: 37.62 },
    'Baghdad': { color: 'black', x: 770, y: 255, lat: 33.31, lon: 44.36 },
    'Riyadh': { color: 'black', x: 780, y: 340, lat: 24.71, lon: 46.68 },
    'Tehran': { color: 'black', x: 850, y: 195, lat: 35.69, lon: 51.39 },
    'Karachi': { color: 'black', x: 860, y: 290, lat: 24.86, lon: 67.01 },
    'Delhi': { color: 'black', x: 935, y: 255, lat: 28.61, lon: 77.21 },
    'Mumbai': { color: 'black', x: 870, y: 375, lat: 19.08, lon: 72.88 },
    'Chennai': { color: 'black', x: 945, y: 430, lat: 13.08, lon: 80.27 },
    'Kolkata': { color: 'black', x: 1005, y: 275, lat: 22.57, lon: 88.36 },

    'Beijing': { color: 'red', x: 1040, y: 160, lat: 39.9, lon: 116.41 },
    'Seoul': { color: 'red', x: 1120, y: 150, lat: 37.57, lon: 126.98 },
    'Tokyo': { color: 'red', x: 1185, y: 205, lat: 35.68, lon: 139.69 },
    'Shanghai': { color: 'red', x: 1050, y: 230, lat: 31.23, lon: 121.47 },
    'Osaka': { color: 'red', x: 1190, y: 285, lat: 34.69, lon: 135.5 },
    'Taipei': { color: 'red', x: 1120, y: 315, lat: 25.03, lon: 121.57 },
    'Hong Kong': { color: 'red', x: 1060, y: 325, lat: 22.32, lon: 114.17 },
    'Bangkok': { color: 'red', x: 1000, y: 375, lat: 13.76, lon: 100.5 },
    'Ho Chi Minh City': { color: 'red', x: 1070, y: 440, lat: 10.82, lon: 106.63 },
    'Manila': { color: 'red', x: 1160, y: 430, lat: 14.6, lon: 120.98 },
    'Jakarta': { color: 'red', x: 1005, y: 500, lat: -6.21, lon: 106.85 },
    'Sydney': { color: 'red', x: 1175, y: 590, lat: -33.87, lon: 151.21 },
  };
  const MAP_W = 1240, MAP_H = 660;

  const EDGES = [
    ['Austin', 'Chicago'], ['Austin', 'Washington'], ['Austin', 'Miami'],
    ['Chicago', 'San Francisco'], ['Chicago', 'Los Angeles'], ['Chicago', 'Mexico City'], ['Chicago', 'Montreal'],
    ['Montreal', 'Boston'], ['Montreal', 'Washington'],
    ['Boston', 'Washington'], ['Boston', 'London'], ['Boston', 'Madrid'],
    ['Washington', 'Miami'],
    ['San Francisco', 'Los Angeles'], ['San Francisco', 'Tokyo'], ['San Francisco', 'Manila'],
    ['London', 'Madrid'], ['London', 'Paris'], ['London', 'Essen'],
    ['Madrid', 'Paris'], ['Madrid', 'Algiers'], ['Madrid', 'Sao Paulo'],
    ['Paris', 'Essen'], ['Paris', 'Milan'], ['Paris', 'Algiers'],
    ['Essen', 'Milan'], ['Essen', 'St. Petersburg'],
    ['Milan', 'Istanbul'],
    ['St. Petersburg', 'Istanbul'], ['St. Petersburg', 'Moscow'],
    ['Los Angeles', 'Mexico City'], ['Los Angeles', 'Sydney'],
    ['Mexico City', 'Miami'], ['Mexico City', 'Bogota'], ['Mexico City', 'Lima'],
    ['Miami', 'Bogota'],
    ['Bogota', 'Lima'], ['Bogota', 'Buenos Aires'], ['Bogota', 'Sao Paulo'],
    ['Lima', 'Santiago'],
    ['Buenos Aires', 'Sao Paulo'],
    ['Sao Paulo', 'Lagos'],
    ['Lagos', 'Khartoum'], ['Lagos', 'Kinshasa'],
    ['Kinshasa', 'Khartoum'], ['Kinshasa', 'Johannesburg'],
    ['Johannesburg', 'Khartoum'],
    ['Khartoum', 'Cairo'],
    ['Algiers', 'Istanbul'], ['Algiers', 'Cairo'],
    ['Cairo', 'Istanbul'], ['Cairo', 'Baghdad'], ['Cairo', 'Riyadh'],
    ['Istanbul', 'Moscow'], ['Istanbul', 'Baghdad'],
    ['Moscow', 'Tehran'],
    ['Baghdad', 'Tehran'], ['Baghdad', 'Karachi'], ['Baghdad', 'Riyadh'],
    ['Riyadh', 'Karachi'],
    ['Tehran', 'Karachi'], ['Tehran', 'Delhi'],
    ['Karachi', 'Mumbai'], ['Karachi', 'Delhi'],
    ['Delhi', 'Mumbai'], ['Delhi', 'Chennai'], ['Delhi', 'Kolkata'],
    ['Mumbai', 'Chennai'],
    ['Chennai', 'Kolkata'], ['Chennai', 'Bangkok'], ['Chennai', 'Jakarta'],
    ['Kolkata', 'Bangkok'], ['Kolkata', 'Hong Kong'],
    ['Beijing', 'Shanghai'], ['Beijing', 'Seoul'],
    ['Seoul', 'Shanghai'], ['Seoul', 'Tokyo'],
    ['Tokyo', 'Shanghai'], ['Tokyo', 'Osaka'],
    ['Shanghai', 'Taipei'], ['Shanghai', 'Hong Kong'],
    ['Osaka', 'Taipei'],
    ['Taipei', 'Hong Kong'], ['Taipei', 'Manila'],
    ['Hong Kong', 'Manila'], ['Hong Kong', 'Ho Chi Minh City'], ['Hong Kong', 'Bangkok'],
    ['Bangkok', 'Ho Chi Minh City'], ['Bangkok', 'Jakarta'],
    ['Ho Chi Minh City', 'Jakarta'], ['Ho Chi Minh City', 'Manila'],
    ['Manila', 'Sydney'],
    ['Jakarta', 'Sydney'],
  ];

  const ADJ = {};
  Object.keys(CITIES).forEach(c => { ADJ[c] = []; });
  EDGES.forEach(([a, b]) => { ADJ[a].push(b); ADJ[b].push(a); });

  const ROLES = {
    // Base game (2nd edition)
    contingencyPlanner: { name: 'Contingency Planner', color: '#27b5a8', set: 'base',
      text: 'As an action, take any discarded Event card and store it on this card (1 at a time). When you play the stored Event, remove it from the game.' },
    dispatcher: { name: 'Dispatcher', color: '#d94fa6', set: 'base',
      text: "Move another player's pawn as if it were yours (using your cards). As an action, move any pawn to a city containing another pawn." },
    medic: { name: 'Medic', color: '#f08a24', set: 'base',
      text: 'Treat Disease removes all cubes of one color. Automatically removes cubes of cured diseases from your city (and prevents them being placed there).' },
    opsExpert: { name: 'Operations Expert', color: '#8fcf3c', set: 'base',
      text: 'Build a research station without discarding. Once per turn, move from a research station to any city by discarding any City card.' },
    quarantineSpecialist: { name: 'Quarantine Specialist', color: '#1f7a3d', set: 'base',
      text: 'Prevent disease cube placements (and outbreaks) in your city and all cities connected to it.' },
    researcher: { name: 'Researcher', color: '#9c5b34', set: 'base',
      text: 'When sharing knowledge, you may give any City card (not only the one for your city). Others may take any City card from you.' },
    scientist: { name: 'Scientist', color: '#e8e8e8', set: 'base',
      text: 'You need only 4 City cards of the same color to Discover a Cure.' },
    // On the Brink
    archivist: { name: 'Archivist', color: '#5b6ee1', set: 'brink',
      text: 'Hand limit is 8. Once per turn, as an action, take the City card matching your current city from the Player Discard pile into your hand.' },
    containmentSpecialist: { name: 'Containment Specialist', color: '#5fc8e8', set: 'brink',
      text: 'When you enter a city, remove 1 cube of each color that has 2 or more cubes there.' },
    epidemiologist: { name: 'Epidemiologist', color: '#b062d6', set: 'brink',
      text: 'Once during your turn (free, not an action), take any City card from another player in your city.' },
    fieldOperative: { name: 'Field Operative', color: '#c9a55a', set: 'brink',
      text: 'Once per turn, as an action, move 1 cube from your city onto this card. When discovering a cure, you may replace 2 City cards with 3 cubes of that color from this card.' },
    generalist: { name: 'Generalist', color: '#9aa0a8', set: 'brink',
      text: 'You may take up to 5 actions each turn.' },
    troubleshooter: { name: 'Troubleshooter', color: '#e0524a', set: 'brink',
      text: 'At the start of your turn, see the top Infection cards (as many as the infection rate). As an action, Direct Flight by revealing (not discarding) the destination City card.' },
  };

  const EVENTS = {
    airlift: { name: 'Airlift', set: 'base', text: 'Move any 1 pawn to any city.' },
    forecast: { name: 'Forecast', set: 'base', text: 'Look at the top 6 Infection cards and rearrange them in any order.' },
    governmentGrant: { name: 'Government Grant', set: 'base', text: 'Add 1 research station to any city (no City card needed).' },
    oneQuietNight: { name: 'One Quiet Night', set: 'base', text: 'Skip the next Infect Cities step.' },
    resilientPopulation: { name: 'Resilient Population', set: 'base', text: 'Remove any 1 card in the Infection Discard Pile from the game. (Can be played between the Infect and Intensify steps of an epidemic.)' },
    borrowedTime: { name: 'Borrowed Time', set: 'brink', text: 'The current player may take 2 extra actions this turn (play during the actions phase).' },
    commercialTravelBan: { name: 'Commercial Travel Ban', set: 'brink', text: 'Play at the start of your turn. Draw only 1 Infection card in each Infect Cities step until your next turn begins.' },
    mobileHospital: { name: 'Mobile Hospital', set: 'brink', text: 'For the rest of this turn, the current player removes 1 cube when entering a city.' },
    newAssignment: { name: 'New Assignment', set: 'brink', text: "Exchange any player's role with an unused role." },
    rapidVaccineDeployment: { name: 'Rapid Vaccine Deployment', set: 'brink', text: 'Play right after a cure is discovered: remove up to 5 cubes of that color from a group of connected cities (at least 1 from each).' },
    reexaminedResearch: { name: 'Re-examined Research', set: 'brink', text: 'Take a City card from the Player Discard pile and give it to any player.' },
    remoteTreatment: { name: 'Remote Treatment', set: 'brink', text: 'Remove up to 2 disease cubes from anywhere on the board.' },
    specialOrders: { name: 'Special Orders', set: 'brink', text: 'For the rest of this turn, the current player may move one other pawn as if it were their own.' },
  };

  const DIFFICULTIES = [
    { epidemics: 4, name: 'Introductory' },
    { epidemics: 5, name: 'Standard' },
    { epidemics: 6, name: 'Heroic' },
    { epidemics: 7, name: 'Legendary' },
  ];

  return { COLORS, COLOR_HEX, CITIES, MAP_W, MAP_H, EDGES, ADJ, ROLES, EVENTS, DIFFICULTIES };
}));
