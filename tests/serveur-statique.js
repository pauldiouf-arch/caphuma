const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || 8123);
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
    '.woff2': 'font/woff2', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.txt': 'text/plain; charset=utf-8',
};

http.createServer((requete, reponse) => {
    const chemin = decodeURIComponent(new URL(requete.url, 'http://localhost').pathname);
    const fichier = path.join(RACINE, chemin === '/' ? 'index.html' : chemin);
    if (!fichier.startsWith(RACINE + path.sep)) {
        reponse.writeHead(403).end();
        return;
    }
    fs.readFile(fichier, (erreur, contenu) => {
        if (erreur) {
            reponse.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('introuvable');
            return;
        }
        reponse.writeHead(200, { 'content-type': TYPES[path.extname(fichier)] || 'application/octet-stream', 'cache-control': 'no-store' });
        reponse.end(contenu);
    });
}).listen(PORT, '127.0.0.1');
