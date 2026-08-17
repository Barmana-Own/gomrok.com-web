const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

http
  .createServer((request, response) => {
    const requestedPath = decodeURIComponent(request.url.split('?')[0]);
    const relativePath = requestedPath === '/' ? '/index.html' : requestedPath;
    const filePath = path.resolve(root, `.${relativePath}`);
    const relativeToRoot = path.relative(root, filePath);

    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500);
        response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
        return;
      }

      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(content);
    });
  })
  .listen(4173, '127.0.0.1', () => {
    console.log('Gomrok auth preview: http://127.0.0.1:4173');
  });
