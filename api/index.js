require('dotenv').config();

// Point d'entrée Vercel — délègue tout à l'application Express principale.
const app = require('../index');

module.exports = app;
