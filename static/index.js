const { mime } = require('azure-functions');
const path = require('path');
const fs = require('fs');

module.exports = async function (context, req) {
  const fileName = context.bindingData.fileName;
  const filePath = path.join(__dirname, '../_images', fileName);

  try {
    const content = fs.readFileSync(filePath);
    let contentType;
    if (fileName.endsWith('.png')) contentType = 'image/png';
    else if (fileName.endsWith('.jpg')) contentType = 'image/jpeg';
    else if (fileName.endsWith('.css')) contentType = 'text/css';
    else if (fileName.endsWith('.js')) contentType = 'text/javascript';
    else contentType = 'application/octet-stream';

    context.res = {
      status: 200,
      headers: { 'Content-Type': contentType },
      body: content,
      isRaw: true
    };
  } catch (error) {
    context.res = { status: 404, body: 'File not found' };
  }
};