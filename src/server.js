const app = require('./app');
const port = process.env.PORT || 7000;
app.listen(port, () => console.log(`SpotIO prêt sur http://127.0.0.1:${port}/configure`));
