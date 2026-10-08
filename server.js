// Local development server. The game itself is fully static (peer-to-peer),
// so in production it is served by GitHub Pages straight from public/.
const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`Pandemic dev server: http://localhost:${PORT}`));
