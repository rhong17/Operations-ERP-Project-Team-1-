import fs from 'node:fs';
let domain=fs.readFileSync('worker/domain.mjs','utf8').replaceAll('export ','');
let server=fs.readFileSync('worker/server.mjs','utf8');
let html=fs.readFileSync('worker/index.html','utf8').replace("@import url('');",'');
fs.writeFileSync('worker/index.js',domain+'\nconst HTML='+JSON.stringify(html)+';\n'+server);
