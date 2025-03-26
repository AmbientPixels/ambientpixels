const fs = require('fs');
const path = require('path');
module.exports = async function (context, req) {
  const filePath = path.join(__dirname, '../index.html');
  const html = fs.readFileSync(filePath, 'utf8');
  context.res = { status: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};