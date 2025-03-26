const fs = require('fs');
const path = require('path');

module.exports = async function (context, req) {
  const fileName = req.params.fileName;
  const filePath = path.join(__dirname, '../_images', fileName);

  try {
    if (!fs.existsSync(filePath)) {
      context.res = { status: 404, body: 'File not found' };
      return;
    }
    const fileContent = fs.readFileSync(filePath);
    const mimeType = fileName.endsWith('.png') ? 'image/png' : 'image/jpeg';
    context.res = {
      status: 200,
      headers: { 'Content-Type': mimeType },
      body: fileContent,
      isRaw: true
    };
  } catch (error) {
    context.res = { status: 500, body: `Error: ${error.message}` };
  }
};