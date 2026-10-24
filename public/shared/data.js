// Static game data shared by server and browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PData = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = ['blue', 'yellow', 'black', 'red'];
  const COLOR_HEX = { blue: '#3b7dd8', yellow: '#f2c230', black: '#555b66', red: '#d8433b', purple: '#9b4fd6' };

  // Board coordinates (stylised, roughly matching the physical board) on a 1240x660 canvas,
  // plus real lat/lon used to warp the world-map background so each city sits on its real location.
  const WORLD_CITIES = {
    'Fremont': { color: 'blue', x: 55, y: 205, lat: 37.55, lon: -121.99 },
    'Chicago': { color: 'blue', x: 165, y: 165, lat: 41.88, lon: -87.63 },
    'Toronto': { color: 'blue', x: 265, y: 150, lat: 43.65, lon: -79.38 },
    'Boston': { color: 'blue', x: 350, y: 168, lat: 42.36, lon: -71.06 },
    'Austin': { color: 'blue', x: 192, y: 262, lat: 30.27, lon: -97.74 },
    'Washington': { color: 'blue', x: 320, y: 232, lat: 38.91, lon: -77.04 },
    'London': { color: 'blue', x: 500, y: 118, lat: 51.51, lon: -0.13 },
    'Madrid': { color: 'blue', x: 485, y: 210, lat: 40.42, lon: -3.7 },
    'Paris': { color: 'blue', x: 575, y: 165, lat: 48.86, lon: 2.35 },
    'Marburg': { color: 'blue', x: 620, y: 78, lat: 50.81, lon: 8.77 },
    'Athens': { color: 'blue', x: 655, y: 140, lat: 37.98, lon: 23.73 },
    'St. Petersburg': { color: 'blue', x: 705, y: 80, lat: 59.93, lon: 30.36 },

    'Irvine': { color: 'yellow', x: 75, y: 300, lat: 33.68, lon: -117.83 },
    'Mexico City': { color: 'yellow', x: 160, y: 330, lat: 19.43, lon: -99.13 },
    'Miami': { color: 'yellow', x: 275, y: 310, lat: 25.76, lon: -80.19 },
    'Panama City': { color: 'yellow', x: 275, y: 400, lat: 8.98, lon: -79.52 },
    'Lima': { color: 'yellow', x: 220, y: 490, lat: -12.05, lon: -77.04 },
    'Punta Arenas': { color: 'yellow', x: 275, y: 625, lat: -53.16, lon: -70.92 },
    'Falkland Island': { color: 'yellow', x: 345, y: 580, lat: -51.7, lon: -57.85 },
    'Rio': { color: 'yellow', x: 410, y: 500, lat: -22.91, lon: -43.17 },
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
    'Nanjing': { color: 'red', x: 1050, y: 230, lat: 32.06, lon: 118.8 },
    'Osaka': { color: 'red', x: 1190, y: 285, lat: 34.69, lon: 135.5 },
    'Taipei': { color: 'red', x: 1120, y: 315, lat: 25.03, lon: 121.57 },
    'Wuhan': { color: 'red', x: 1060, y: 325, lat: 30.59, lon: 114.31 },
    'Bangkok': { color: 'red', x: 1000, y: 375, lat: 13.76, lon: 100.5 },
    'Ho Chi Minh City': { color: 'red', x: 1070, y: 440, lat: 10.82, lon: 106.63 },
    'Manila': { color: 'red', x: 1160, y: 430, lat: 14.6, lon: 120.98 },
    'Kuala Lumpur': { color: 'red', x: 1005, y: 500, lat: 3.14, lon: 101.69 },
    'Auckland': { color: 'red', x: 1210, y: 610, lat: -36.85, lon: 174.76 },
  };
  const MAP_W = 1240, MAP_H = 660;

  const WORLD_EDGES = [
    ['Austin', 'Chicago'], ['Austin', 'Washington'], ['Austin', 'Miami'],
    ['Chicago', 'Fremont'], ['Chicago', 'Irvine'], ['Chicago', 'Mexico City'], ['Chicago', 'Toronto'],
    ['Toronto', 'Boston'], ['Toronto', 'Washington'],
    ['Boston', 'Washington'], ['Boston', 'London'], ['Boston', 'Madrid'],
    ['Washington', 'Miami'],
    ['Fremont', 'Irvine'], ['Fremont', 'Tokyo'], ['Fremont', 'Manila'],
    ['London', 'Madrid'], ['London', 'Paris'], ['London', 'Marburg'],
    ['Madrid', 'Paris'], ['Madrid', 'Algiers'], ['Madrid', 'Rio'],
    ['Paris', 'Marburg'], ['Paris', 'Athens'], ['Paris', 'Algiers'],
    ['Marburg', 'Athens'], ['Marburg', 'St. Petersburg'],
    ['Athens', 'Istanbul'],
    ['St. Petersburg', 'Istanbul'], ['St. Petersburg', 'Moscow'],
    ['Irvine', 'Mexico City'], ['Irvine', 'Auckland'],
    ['Mexico City', 'Miami'], ['Mexico City', 'Panama City'], ['Mexico City', 'Lima'],
    ['Miami', 'Panama City'],
    ['Panama City', 'Lima'], ['Panama City', 'Falkland Island'], ['Panama City', 'Rio'],
    ['Lima', 'Punta Arenas'],
    ['Falkland Island', 'Rio'],
    ['Rio', 'Lagos'],
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
    ['Chennai', 'Kolkata'], ['Chennai', 'Bangkok'], ['Chennai', 'Kuala Lumpur'],
    ['Kolkata', 'Bangkok'], ['Kolkata', 'Wuhan'],
    ['Beijing', 'Nanjing'], ['Beijing', 'Seoul'],
    ['Seoul', 'Nanjing'], ['Seoul', 'Tokyo'],
    ['Tokyo', 'Nanjing'], ['Tokyo', 'Osaka'],
    ['Nanjing', 'Taipei'], ['Nanjing', 'Wuhan'],
    ['Osaka', 'Taipei'],
    ['Taipei', 'Wuhan'], ['Taipei', 'Manila'],
    ['Wuhan', 'Manila'], ['Wuhan', 'Ho Chi Minh City'], ['Wuhan', 'Bangkok'],
    ['Bangkok', 'Ho Chi Minh City'], ['Bangkok', 'Kuala Lumpur'],
    ['Ho Chi Minh City', 'Kuala Lumpur'], ['Ho Chi Minh City', 'Manila'],
    ['Manila', 'Auckland'],
    ['Kuala Lumpur', 'Auckland'],
  ];

  // Universities board: the same graph as the cities board (each school takes one city's slot and
  // connections), arranged so each color is one region: blue = West Coast, red = South,
  // black = Midwest, yellow = Northeast (a consistent renaming of the slot colors).
  // Generated by tools/plan-universities.py.
  const UNIVERSITIES = {
    'UTSW': { color: 'red', x: 584, y: 530, lat: 32.812, lon: -96.839 },
    'UT Austin': { color: 'red', x: 589, y: 606, lat: 30.285, lon: -97.734 },
    'Texas A&M': { color: 'red', x: 652, y: 558, lat: 30.619, lon: -96.339 },
    'Rice': { color: 'red', x: 660, y: 630, lat: 29.717, lon: -95.402 },
    'Vanderbilt': { color: 'red', x: 783, y: 443, lat: 36.145, lon: -86.803 },
    'Georgia Tech': { color: 'red', x: 795, y: 518, lat: 33.776, lon: -84.398 },
    'Emory': { color: 'red', x: 872, y: 536, lat: 33.791, lon: -84.324 },
    'Virginia Tech': { color: 'red', x: 878, y: 404, lat: 37.228, lon: -80.423 },
    'UNC': { color: 'red', x: 912, y: 471, lat: 35.905, lon: -79.047 },
    'JHU': { color: 'red', x: 972, y: 325, lat: 39.329, lon: -76.62 },
    'Duke': { color: 'red', x: 985, y: 466, lat: 36.001, lon: -78.938 },
    'UMaryland': { color: 'red', x: 1006, y: 392, lat: 38.987, lon: -76.943 },

    'UBC': { color: 'black', x: 86, y: 41, lat: 49.261, lon: -123.246 },
    'Utah': { color: 'black', x: 460, y: 321, lat: 40.765, lon: -111.842 },
    'CU Boulder': { color: 'black', x: 533, y: 300, lat: 40.007, lon: -105.266 },
    'UMinnesota': { color: 'black', x: 653, y: 126, lat: 44.974, lon: -93.228 },
    'WashU': { color: 'black', x: 706, y: 378, lat: 38.649, lon: -90.311 },
    'UWisconsin': { color: 'black', x: 718, y: 165, lat: 43.076, lon: -89.412 },
    'UIUC': { color: 'black', x: 737, y: 310, lat: 40.102, lon: -88.227 },
    'UChicago': { color: 'black', x: 741, y: 236, lat: 41.789, lon: -87.6 },
    'Northwestern': { color: 'black', x: 791, y: 182, lat: 42.056, lon: -87.675 },
    'Indiana': { color: 'black', x: 800, y: 352, lat: 39.168, lon: -86.523 },
    'Purdue': { color: 'black', x: 804, y: 276, lat: 40.424, lon: -86.921 },
    'UMich': { color: 'black', x: 860, y: 213, lat: 42.278, lon: -83.738 },

    'CMU': { color: 'yellow', x: 918, y: 273, lat: 40.443, lon: -79.943 },
    'UToronto': { color: 'yellow', x: 925, y: 156, lat: 43.663, lon: -79.396 },
    'Cornell': { color: 'yellow', x: 998, y: 185, lat: 42.453, lon: -76.473 },
    'Princeton': { color: 'yellow', x: 1016, y: 266, lat: 40.343, lon: -74.651 },
    'UPenn': { color: 'yellow', x: 1047, y: 335, lat: 39.952, lon: -75.193 },
    'Columbia': { color: 'yellow', x: 1061, y: 207, lat: 40.808, lon: -73.962 },
    'NYU': { color: 'yellow', x: 1089, y: 275, lat: 40.73, lon: -73.997 },
    'McGill': { color: 'yellow', x: 1100, y: 113, lat: 45.505, lon: -73.577 },
    'Yale': { color: 'yellow', x: 1134, y: 215, lat: 41.316, lon: -72.922 },
    'Cornell Tech': { color: 'yellow', x: 1153, y: 306, lat: 40.756, lon: -73.956 },
    'Harvard': { color: 'yellow', x: 1195, y: 172, lat: 42.377, lon: -71.117 },
    'MIT': { color: 'yellow', x: 1200, y: 246, lat: 42.36, lon: -71.094 },

    'UCSF': { color: 'blue', x: 91, y: 315, lat: 37.763, lon: -122.458 },
    'UC Berkeley': { color: 'blue', x: 127, y: 250, lat: 37.872, lon: -122.259 },
    'UW': { color: 'blue', x: 138, y: 96, lat: 47.655, lon: -122.308 },
    'Stanford': { color: 'blue', x: 168, y: 288, lat: 37.428, lon: -122.17 },
    'UCD': { color: 'blue', x: 201, y: 247, lat: 38.539, lon: -121.75 },
    'UCSB': { color: 'blue', x: 258, y: 408, lat: 34.414, lon: -119.849 },
    'USC': { color: 'blue', x: 300, y: 500, lat: 34.022, lon: -118.285 },
    'UCLA': { color: 'blue', x: 332, y: 395, lat: 34.069, lon: -118.445 },
    'Scripps': { color: 'blue', x: 392, y: 511, lat: 32.896, lon: -117.243 },
    'Caltech': { color: 'blue', x: 398, y: 363, lat: 34.138, lon: -118.125 },
    'UCI': { color: 'blue', x: 400, y: 425, lat: 33.64, lon: -117.844 },
    'UCSD': { color: 'blue', x: 445, y: 485, lat: 32.88, lon: -117.234 },
  };
  const UNIVERSITY_EDGES = [
    ['Texas A&M', 'UTSW'], ['Texas A&M', 'Vanderbilt'], ['Texas A&M', 'WashU'], ['UTSW', 'UT Austin'],
    ['UTSW', 'Utah'], ['UTSW', 'CU Boulder'], ['UTSW', 'Rice'], ['Rice', 'Georgia Tech'],
    ['Rice', 'Vanderbilt'], ['Georgia Tech', 'Vanderbilt'], ['Georgia Tech', 'Emory'], ['Georgia Tech', 'Virginia Tech'],
    ['Vanderbilt', 'WashU'], ['UT Austin', 'Utah'], ['UT Austin', 'UCSD'], ['UT Austin', 'Caltech'],
    ['Emory', 'Virginia Tech'], ['Emory', 'UNC'], ['Emory', 'Duke'], ['Virginia Tech', 'UNC'],
    ['Virginia Tech', 'CMU'], ['Virginia Tech', 'Purdue'], ['UNC', 'Duke'], ['UNC', 'JHU'],
    ['UNC', 'CMU'], ['Duke', 'JHU'], ['Duke', 'UMaryland'], ['JHU', 'Princeton'],
    ['UMaryland', 'Princeton'], ['UMaryland', 'UPenn'], ['Utah', 'CU Boulder'], ['Utah', 'UCD'],
    ['CU Boulder', 'WashU'], ['CU Boulder', 'UIUC'], ['CU Boulder', 'UMinnesota'], ['WashU', 'UIUC'],
    ['UIUC', 'UMinnesota'], ['UIUC', 'Indiana'], ['UIUC', 'Purdue'], ['UMinnesota', 'UBC'],
    ['Indiana', 'Purdue'], ['Purdue', 'UMich'], ['UMich', 'Northwestern'], ['UMich', 'UChicago'],
    ['UChicago', 'Northwestern'], ['UChicago', 'UWisconsin'], ['UWisconsin', 'Northwestern'], ['Northwestern', 'UToronto'],
    ['CMU', 'Princeton'], ['CMU', 'UToronto'], ['UToronto', 'Princeton'], ['UToronto', 'Cornell'],
    ['UToronto', 'McGill'], ['Princeton', 'UPenn'], ['Princeton', 'Cornell'], ['UPenn', 'NYU'],
    ['Cornell', 'NYU'], ['Cornell', 'Columbia'], ['Cornell', 'McGill'], ['McGill', 'Columbia'],
    ['NYU', 'Columbia'], ['NYU', 'Cornell Tech'], ['Columbia', 'Yale'], ['Columbia', 'Cornell Tech'],
    ['Cornell Tech', 'Yale'], ['Cornell Tech', 'Harvard'], ['Cornell Tech', 'MIT'], ['Yale', 'Harvard'],
    ['Harvard', 'MIT'], ['Harvard', 'UC Berkeley'], ['Harvard', 'UW'], ['MIT', 'UC Berkeley'],
    ['MIT', 'UCSF'], ['USC', 'UCSB'], ['USC', 'Scripps'], ['Scripps', 'UCSB'],
    ['Scripps', 'UCSD'], ['UCSD', 'UCSB'], ['UCSD', 'UCI'], ['UCSB', 'UCLA'],
    ['UCSB', 'UCSF'], ['UCI', 'UCLA'], ['UCLA', 'UCSF'], ['UCLA', 'Caltech'],
    ['UCSF', 'Caltech'], ['UCSF', 'Stanford'], ['UCSF', 'UC Berkeley'], ['UC Berkeley', 'Stanford'],
    ['UC Berkeley', 'UW'], ['Stanford', 'UW'], ['Stanford', 'Caltech'], ['Caltech', 'UCD'],
    ['UW', 'UCD'],
  ];
  // Which city's slot each school takes (checked by test/rules.js; not used by the game).
  const UNIVERSITY_SLOTS = {"UT Austin": "Fremont", "UTSW": "Chicago", "Rice": "Toronto", "Georgia Tech": "Boston", "Texas A&M": "Austin", "Vanderbilt": "Washington", "Emory": "London", "Virginia Tech": "Madrid", "UNC": "Paris", "Duke": "Marburg", "JHU": "Athens", "UMaryland": "St. Petersburg", "Utah": "Irvine", "CU Boulder": "Mexico City", "WashU": "Miami", "UIUC": "Panama City", "UMinnesota": "Lima", "UBC": "Punta Arenas", "Indiana": "Falkland Island", "Purdue": "Rio", "UMich": "Lagos", "UChicago": "Kinshasa", "Northwestern": "Khartoum", "UWisconsin": "Johannesburg", "CMU": "Algiers", "UToronto": "Cairo", "Princeton": "Istanbul", "UPenn": "Moscow", "Cornell": "Baghdad", "McGill": "Riyadh", "NYU": "Tehran", "Columbia": "Karachi", "Cornell Tech": "Delhi", "Yale": "Mumbai", "Harvard": "Chennai", "MIT": "Kolkata", "USC": "Beijing", "Scripps": "Seoul", "UCSD": "Tokyo", "UCSB": "Nanjing", "UCI": "Osaka", "UCLA": "Taipei", "UCSF": "Wuhan", "UC Berkeley": "Bangkok", "Stanford": "Ho Chi Minh City", "Caltech": "Manila", "UW": "Kuala Lumpur", "UCD": "Auckland"};

  // East Asia board (China, Japan, Korea): generated by tools/plan-board.py eastasia. Cities carry their
  // province/region and simplified Chinese name (`region`, `zh`), shown on infection cards and tooltips.
  const EAST_ASIA = {
    "Xi'an": { color: 'blue', x: 271, y: 302, lat: 34.341, lon: 108.94, region: 'Shaanxi', zh: '西安' },
    'Taiyuan': { color: 'blue', x: 385, y: 207, lat: 37.87, lon: 112.549, region: 'Shanxi', zh: '太原' },
    'Zhengzhou': { color: 'blue', x: 442, y: 277, lat: 34.747, lon: 113.625, region: 'Henan', zh: '郑州' },
    'Shijiazhuang': { color: 'blue', x: 476, y: 200, lat: 38.042, lon: 114.515, region: 'Hebei', zh: '石家庄' },
    'Beijing': { color: 'blue', x: 522, y: 140, lat: 39.904, lon: 116.407, region: 'Beijing Municipality', zh: '北京' },
    'Jinan': { color: 'blue', x: 560, y: 240, lat: 36.651, lon: 117.12, region: 'Shandong', zh: '济南' },
    'Tianjin': { color: 'blue', x: 591, y: 171, lat: 39.084, lon: 117.201, region: 'Tianjin Municipality', zh: '天津' },
    'Qingdao': { color: 'blue', x: 680, y: 244, lat: 36.067, lon: 120.383, region: 'Shandong', zh: '青岛' },
    'Dalian': { color: 'blue', x: 721, y: 181, lat: 38.914, lon: 121.615, region: 'Liaoning', zh: '大连' },
    'Shenyang': { color: 'blue', x: 751, y: 110, lat: 41.805, lon: 123.432, region: 'Liaoning', zh: '沈阳' },
    'Changchun': { color: 'blue', x: 827, y: 107, lat: 43.817, lon: 125.324, region: 'Jilin', zh: '长春' },
    'Harbin': { color: 'blue', x: 853, y: 38, lat: 45.803, lon: 126.535, region: 'Heilongjiang', zh: '哈尔滨' },

    'Changsha': { color: 'yellow', x: 418, y: 453, lat: 28.228, lon: 112.939, region: 'Hunan', zh: '长沙' },
    'Wuhan': { color: 'yellow', x: 465, y: 389, lat: 30.593, lon: 114.305, region: 'Hubei', zh: '武汉' },
    'Nanchang': { color: 'yellow', x: 520, y: 441, lat: 28.682, lon: 115.858, region: 'Jiangxi', zh: '南昌' },
    'Hefei': { color: 'yellow', x: 540, y: 344, lat: 31.821, lon: 117.227, region: 'Anhui', zh: '合肥' },
    'Xiamen': { color: 'yellow', x: 590, y: 568, lat: 24.48, lon: 118.089, region: 'Fujian', zh: '厦门' },
    'Nanjing': { color: 'yellow', x: 608, y: 372, lat: 32.06, lon: 118.797, region: 'Jiangsu', zh: '南京' },
    'Fuzhou': { color: 'yellow', x: 633, y: 507, lat: 26.074, lon: 119.296, region: 'Fujian', zh: '福州' },
    'Yangzhou': { color: 'yellow', x: 657, y: 317, lat: 32.394, lon: 119.413, region: 'Jiangsu', zh: '扬州' },
    'Hangzhou': { color: 'yellow', x: 676, y: 403, lat: 30.274, lon: 120.155, region: 'Zhejiang', zh: '杭州' },
    'Wenzhou': { color: 'yellow', x: 701, y: 474, lat: 28.0, lon: 120.672, region: 'Zhejiang', zh: '温州' },
    'Shanghai': { color: 'yellow', x: 726, y: 347, lat: 31.23, lon: 121.474, region: 'Shanghai Municipality', zh: '上海' },
    'Ningbo': { color: 'yellow', x: 750, y: 418, lat: 29.868, lon: 121.544, region: 'Zhejiang', zh: '宁波' },

    'Incheon': { color: 'red', x: 825, y: 239, lat: 37.456, lon: 126.705, region: 'South Korea', zh: '仁川' },
    'Seoul': { color: 'red', x: 861, y: 175, lat: 37.567, lon: 126.978, region: 'South Korea', zh: '首尔' },
    'Busan': { color: 'red', x: 868, y: 308, lat: 35.18, lon: 129.076, region: 'South Korea', zh: '釜山' },
    'Daegu': { color: 'red', x: 915, y: 223, lat: 35.871, lon: 128.601, region: 'South Korea', zh: '大邱' },
    'Fukuoka': { color: 'red', x: 951, y: 314, lat: 33.59, lon: 130.402, region: 'Fukuoka, Japan', zh: '福冈' },
    'Kobe': { color: 'red', x: 1008, y: 264, lat: 34.69, lon: 135.196, region: 'Hyogo, Japan', zh: '神户' },
    'Osaka': { color: 'red', x: 1053, y: 322, lat: 34.694, lon: 135.502, region: 'Osaka, Japan', zh: '大阪' },
    'Kyoto': { color: 'red', x: 1074, y: 230, lat: 35.012, lon: 135.768, region: 'Kyoto, Japan', zh: '京都' },
    'Nagoya': { color: 'red', x: 1119, y: 289, lat: 35.181, lon: 136.906, region: 'Aichi, Japan', zh: '名古屋' },
    'Tokyo': { color: 'red', x: 1145, y: 198, lat: 35.69, lon: 139.692, region: 'Tokyo, Japan', zh: '东京' },
    'Sapporo': { color: 'red', x: 1192, y: 94, lat: 43.062, lon: 141.354, region: 'Hokkaido, Japan', zh: '札幌' },
    'Yokohama': { color: 'red', x: 1193, y: 279, lat: 35.444, lon: 139.638, region: 'Kanagawa, Japan', zh: '横滨' },

    '\u00dcr\u00fcmqi': { color: 'black', x: 48, y: 80, lat: 43.825, lon: 87.617, region: 'Xinjiang', zh: '乌鲁木齐' },
    'Lhasa': { color: 'black', x: 66, y: 414, lat: 29.652, lon: 91.172, region: 'Tibet', zh: '拉萨' },
    'Kunming': { color: 'black', x: 151, y: 539, lat: 25.039, lon: 102.718, region: 'Yunnan', zh: '昆明' },
    'Chengdu': { color: 'black', x: 167, y: 387, lat: 30.573, lon: 104.066, region: 'Sichuan', zh: '成都' },
    'Lanzhou': { color: 'black', x: 225, y: 202, lat: 36.061, lon: 103.834, region: 'Gansu', zh: '兰州' },
    'Guiyang': { color: 'black', x: 233, y: 496, lat: 26.647, lon: 106.63, region: 'Guizhou', zh: '贵阳' },
    'Chongqing': { color: 'black', x: 236, y: 419, lat: 29.563, lon: 106.551, region: 'Chongqing Municipality', zh: '重庆' },
    'Nanning': { color: 'black', x: 275, y: 602, lat: 22.817, lon: 108.367, region: 'Guangxi', zh: '南宁' },
    'Zhangjiajie': { color: 'black', x: 338, y: 429, lat: 29.117, lon: 110.479, region: 'Hunan', zh: '张家界' },
    'Guangzhou': { color: 'black', x: 408, y: 596, lat: 23.129, lon: 113.264, region: 'Guangdong', zh: '广州' },
    'Shenzhen': { color: 'black', x: 468, y: 557, lat: 22.543, lon: 114.058, region: 'Guangdong', zh: '深圳' },
    'Hong Kong': { color: 'black', x: 474, y: 630, lat: 22.32, lon: 114.17, region: 'Hong Kong SAR', zh: '香港' },
  };
  const EAST_ASIA_EDGES = [
    ['Zhengzhou', 'Taiyuan'], ['Zhengzhou', 'Shijiazhuang'], ['Zhengzhou', 'Hefei'], ['Taiyuan', "Xi'an"],
    ['Taiyuan', 'Changsha'], ['Taiyuan', 'Wuhan'], ['Taiyuan', 'Beijing'], ['Beijing', 'Jinan'],
    ['Beijing', 'Shijiazhuang'], ['Jinan', 'Shijiazhuang'], ['Jinan', 'Tianjin'], ['Jinan', 'Qingdao'],
    ['Shijiazhuang', 'Hefei'], ["Xi'an", 'Changsha'], ["Xi'an", 'Shenzhen'], ["Xi'an", 'Chongqing'],
    ['Tianjin', 'Qingdao'], ['Tianjin', 'Dalian'], ['Tianjin', 'Shenyang'], ['Qingdao', 'Dalian'],
    ['Qingdao', 'Busan'], ['Qingdao', 'Yangzhou'], ['Dalian', 'Shenyang'], ['Dalian', 'Changchun'],
    ['Dalian', 'Busan'], ['Shenyang', 'Changchun'], ['Shenyang', 'Harbin'], ['Changchun', 'Incheon'],
    ['Harbin', 'Incheon'], ['Harbin', 'Seoul'], ['Changsha', 'Wuhan'], ['Changsha', 'Lanzhou'],
    ['Wuhan', 'Hefei'], ['Wuhan', 'Nanjing'], ['Wuhan', 'Nanchang'], ['Hefei', 'Nanjing'],
    ['Nanjing', 'Nanchang'], ['Nanjing', 'Fuzhou'], ['Nanjing', 'Yangzhou'], ['Nanchang', 'Xiamen'],
    ['Fuzhou', 'Yangzhou'], ['Yangzhou', 'Shanghai'], ['Shanghai', 'Ningbo'], ['Shanghai', 'Hangzhou'],
    ['Hangzhou', 'Ningbo'], ['Hangzhou', 'Wenzhou'], ['Wenzhou', 'Ningbo'], ['Ningbo', 'Fukuoka'],
    ['Busan', 'Incheon'], ['Busan', 'Fukuoka'], ['Fukuoka', 'Incheon'], ['Fukuoka', 'Kobe'],
    ['Fukuoka', 'Osaka'], ['Incheon', 'Seoul'], ['Incheon', 'Kobe'], ['Seoul', 'Daegu'],
    ['Kobe', 'Daegu'], ['Kobe', 'Kyoto'], ['Kobe', 'Osaka'], ['Osaka', 'Kyoto'],
    ['Daegu', 'Kyoto'], ['Daegu', 'Tokyo'], ['Kyoto', 'Sapporo'], ['Kyoto', 'Tokyo'],
    ['Tokyo', 'Sapporo'], ['Tokyo', 'Yokohama'], ['Tokyo', 'Nagoya'], ['Sapporo', 'Yokohama'],
    ['Yokohama', 'Nagoya'], ['Yokohama', 'Lhasa'], ['Yokohama', '\u00dcr\u00fcmqi'], ['Nagoya', 'Lhasa'],
    ['Nagoya', 'Kunming'], ['Hong Kong', 'Nanning'], ['Hong Kong', 'Guangzhou'], ['Guangzhou', 'Nanning'],
    ['Guangzhou', 'Shenzhen'], ['Shenzhen', 'Nanning'], ['Shenzhen', 'Zhangjiajie'], ['Nanning', 'Guiyang'],
    ['Nanning', 'Kunming'], ['Zhangjiajie', 'Guiyang'], ['Guiyang', 'Kunming'], ['Guiyang', 'Chongqing'],
    ['Kunming', 'Chongqing'], ['Kunming', 'Chengdu'], ['Kunming', 'Lhasa'], ['Lhasa', 'Chengdu'],
    ['Lhasa', '\u00dcr\u00fcmqi'], ['Chengdu', '\u00dcr\u00fcmqi'], ['Chengdu', 'Chongqing'], ['Chongqing', 'Lanzhou'],
    ['\u00dcr\u00fcmqi', 'Lanzhou'],
  ];
  // Which city's slot each place takes (checked by test/rules.js; not used by the game).
  const EAST_ASIA_SLOTS = {"Xi'an": "Fremont", "Taiyuan": "Chicago", "Beijing": "Toronto", "Jinan": "Boston", "Zhengzhou": "Austin", "Shijiazhuang": "Washington", "Tianjin": "London", "Qingdao": "Madrid", "Dalian": "Paris", "Shenyang": "Marburg", "Changchun": "Athens", "Harbin": "St. Petersburg", "Changsha": "Irvine", "Wuhan": "Mexico City", "Hefei": "Miami", "Nanjing": "Panama City", "Nanchang": "Lima", "Xiamen": "Punta Arenas", "Fuzhou": "Falkland Island", "Yangzhou": "Rio", "Shanghai": "Lagos", "Hangzhou": "Kinshasa", "Ningbo": "Khartoum", "Wenzhou": "Johannesburg", "Busan": "Algiers", "Fukuoka": "Cairo", "Incheon": "Istanbul", "Seoul": "Moscow", "Kobe": "Baghdad", "Osaka": "Riyadh", "Daegu": "Tehran", "Kyoto": "Karachi", "Tokyo": "Delhi", "Sapporo": "Mumbai", "Yokohama": "Chennai", "Nagoya": "Kolkata", "Hong Kong": "Beijing", "Guangzhou": "Seoul", "Shenzhen": "Tokyo", "Nanning": "Nanjing", "Zhangjiajie": "Osaka", "Guiyang": "Taipei", "Kunming": "Wuhan", "Lhasa": "Bangkok", "Chengdu": "Ho Chi Minh City", "Chongqing": "Manila", "Ürümqi": "Kuala Lumpur", "Lanzhou": "Auckland"};

  // Boards share the rules engine; `start` is where pawns and the first research station begin,
  // `land` names the global (from worldmap.js / usmap.js) holding the background coastline path.
  const BOARDS = {
    cities: { name: 'World cities', start: 'Austin', land: 'WORLD_LAND', cities: WORLD_CITIES, edges: WORLD_EDGES },
    universities: { name: 'Universities', start: 'Texas A&M', land: 'US_LAND', cities: UNIVERSITIES, edges: UNIVERSITY_EDGES, slots: UNIVERSITY_SLOTS },
    eastasia: { name: 'China, Japan & Korea', start: 'Zhengzhou', land: 'ASIA_LAND', cities: EAST_ASIA, edges: EAST_ASIA_EDGES, slots: EAST_ASIA_SLOTS },
  };
  const DEFAULT_BOARD = 'cities';

  // The active board. These objects are filled in place by useBoard(), so modules that grabbed them
  // at load time (engine, UI) always see the current board.
  const CITIES = {};
  const CITY_NAMES = [];
  const EDGES = [];
  const ADJ = {};
  let board = null;
  function useBoard(key) {
    key = BOARDS[key] ? key : DEFAULT_BOARD;
    if (key === board) return key;
    const b = BOARDS[key];
    for (const k of Object.keys(CITIES)) delete CITIES[k];
    for (const k of Object.keys(ADJ)) delete ADJ[k];
    Object.assign(CITIES, b.cities);
    CITY_NAMES.splice(0, CITY_NAMES.length, ...Object.keys(b.cities));
    EDGES.splice(0, EDGES.length, ...b.edges);
    CITY_NAMES.forEach(c => { ADJ[c] = []; });
    EDGES.forEach(([a, c]) => { ADJ[a].push(c); ADJ[c].push(a); });
    board = key;
    return key;
  }
  useBoard(DEFAULT_BOARD);

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
      text: 'Once during your turn (not an action), take any City card from a player in the same city as you.' },
    fieldOperative: { name: 'Field Operative', color: '#c9a55a', set: 'brink',
      text: 'Once per turn, as an action, move 1 cube from your city onto this card. When discovering a cure, you may replace 2 City cards with 3 cubes of that color from this card.' },
    generalist: { name: 'Generalist', color: '#9aa0a8', set: 'brink',
      text: 'You may take up to 5 actions each turn.' },
    troubleshooter: { name: 'Troubleshooter', color: '#e0524a', set: 'brink',
      text: 'Start your turn by looking at as many Infection cards as the infection rate. When you take a Direct Flight, reveal the City card used but do not discard it.' },
  };

  // Event texts follow the 2nd-edition cards.
  const EVENTS = {
    airlift: { name: 'Airlift', set: 'base', text: 'Move any 1 pawn to any city.' },
    forecast: { name: 'Forecast', set: 'base', text: 'Look at the top 6 Infection cards and rearrange them in any order.' },
    governmentGrant: { name: 'Government Grant', set: 'base', text: 'Add 1 research station to any city (no City card needed).' },
    oneQuietNight: { name: 'One Quiet Night', set: 'base', text: 'Skip the next Infect Cities step.' },
    resilientPopulation: { name: 'Resilient Population', set: 'base', text: 'Remove any 1 card in the Infection Discard Pile from the game. (Can be played between the Infect and Intensify steps of an epidemic.)' },
    borrowedTime: { name: 'Borrowed Time', set: 'brink', text: 'Take 2 extra actions this turn (only while the current player is still taking actions).' },
    commercialTravelBan: { name: 'Commercial Travel Ban', set: 'brink', text: "The infection rate is 1 until the current player's next turn begins." },
    mobileHospital: { name: 'Mobile Hospital', set: 'brink', text: 'This turn, remove 1 disease cube from each city the current player drives/ferries to.' },
    newAssignment: { name: 'New Assignment', set: 'brink', text: 'Select a player. That player may swap their Role with any one of the unused Roles.' },
    rapidVaccineDeployment: { name: 'Rapid Vaccine Deployment', set: 'brink', text: 'Play immediately after a Discover a Cure action to remove 1-5 cubes of the cured disease. These cubes must come from connected cities.' },
    reexaminedResearch: { name: 'Re-examined Research', set: 'brink', text: 'Select a player. That player may draw any 1 City card from the Player Discard Pile into their hand.' },
    remoteTreatment: { name: 'Remote Treatment', set: 'brink', text: 'Remove 2 disease cubes from the board.' },
    specialOrders: { name: 'Special Orders', set: 'brink', text: 'This turn, the current player may spend actions to move 1 other pawn as if it were their own.' },
    // Custom (house) events: they change the map's connections for the rest of the game.
    newRoute: { name: 'New Route', set: 'custom', text: 'Connect 2 cities of the same color that are not already connected. For the rest of the game, pawns can Drive/Ferry along it, but disease does not spread along it.' },
    borderClosure: { name: 'Border Closure', set: 'custom', text: 'Remove up to 2 connections, each between 2 cities. For the rest of the game, pawns cannot Drive/Ferry along them and outbreaks do not spread along them.' },
  };

  // Virulent Strain challenge: epidemic cards whose extra effect hits only the Virulent Strain disease.
  const VIRULENT = {
    chronicEffect: { name: 'Chronic Effect', continuing: true,
      text: 'During Infections, when a Virulent Strain city with no Virulent Strain cubes is drawn, place 2 cubes instead of 1. (Not for Epidemics or Outbreaks.)' },
    complexMolecularStructure: { name: 'Complex Molecular Structure', continuing: true,
      text: 'Until it is cured, you need 1 more City card to Discover a Cure for the Virulent Strain.' },
    governmentInterference: { name: 'Government Interference', continuing: true,
      text: 'To leave a city with Virulent Strain cubes, the current player must first Treat at least 1 Virulent Strain cube in that city this turn.' },
    rateEffect: { name: 'Rate Effect', continuing: true,
      text: 'During Infections, draw 1 more card than the infection rate if at least 1 Infection card drawn was a Virulent Strain city.' },
    slipperySlope: { name: 'Slippery Slope', continuing: true,
      text: 'Virulent Strain outbreaks move the outbreak marker forward 2 spaces (not 1).' },
    hiddenPocket: { name: 'Hidden Pocket', continuing: false,
      text: 'If the Virulent Strain is eradicated but at least 1 of its cards is in the Infection Discard Pile, it is no longer eradicated: place 1 cube on each of those cities.' },
    unacceptableLoss: { name: 'Unacceptable Loss', continuing: false,
      text: 'Remove 4 Virulent Strain cubes from the supply (from the game).' },
    uncountedPopulations: { name: 'Uncounted Populations', continuing: false,
      text: 'Place 1 Virulent Strain cube on each city with exactly 1 of these cubes.' },
  };

  // Mutation challenge: a 5th (purple) disease with 12 cubes.
  const MUTATION_EVENTS = {
    threatens: { name: 'The Mutation Threatens!', text: 'If purple is not eradicated: draw the bottom Infection card and place 3 purple cubes there.' },
    spreads: { name: 'The Mutation Spreads', text: 'If purple is not eradicated: draw 3 cards from the bottom of the Infection deck and place 1 purple cube on each.' },
    intensifies: { name: 'The Mutation Intensifies!', text: 'Place 1 purple cube on each city with exactly 2 purple cubes.' },
  };

  const CHALLENGES = {
    virulent: { name: 'Virulent Strain', text: 'One disease becomes particularly nasty: special epidemic cards add lasting or immediate effects to it.' },
    mutation: { name: 'Mutation', text: 'A 5th purple disease (only 12 cubes) appears through Mutation cards. Cure it with 5 City cards of any color, at least one from a city with purple cubes.' },
  };

  const DIFFICULTIES = [
    { epidemics: 4, name: 'Introductory' },
    { epidemics: 5, name: 'Standard' },
    { epidemics: 6, name: 'Heroic' },
    { epidemics: 7, name: 'Legendary' },
  ];

  const api = { COLORS, COLOR_HEX, CITIES, CITY_NAMES, MAP_W, MAP_H, EDGES, ADJ, ROLES, EVENTS, VIRULENT, MUTATION_EVENTS, CHALLENGES, DIFFICULTIES,
    BOARDS, DEFAULT_BOARD, useBoard };
  Object.defineProperty(api, 'board', { get: () => board, enumerable: true });
  Object.defineProperty(api, 'START', { get: () => BOARDS[board].start, enumerable: true });
  return api;
}));
