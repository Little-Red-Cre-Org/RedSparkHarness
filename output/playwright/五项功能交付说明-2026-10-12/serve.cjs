const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.png':'image/png','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8'};
http.createServer((req,res)=>{
  const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);
  const file = path.resolve(root,name || 'RSH-五项功能报告.html');
  if (path.dirname(file)!==root || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',types[path.extname(file)] || 'text/plain; charset=utf-8');
  fs.createReadStream(file).pipe(res);
}).listen(0,'127.0.0.1',function(){console.log('REPORT_PREVIEW http://127.0.0.1:'+this.address().port);});
