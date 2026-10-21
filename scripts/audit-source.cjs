// Offline, dependency-free pre-upload check. Reports locations, never secret values.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
process.chdir(path.resolve(__dirname,'..'));
const mode=process.argv.includes('--staged')?'staged':'working';
const args=mode==='staged'?['ls-files','--cached','-z']:['ls-files','--cached','--others','--exclude-standard','-z'];
const files=[...new Set(execFileSync('git',args,{encoding:'utf8'}).split('\0').filter(Boolean))];
const rules=[
 ['provider credential',/\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{15,}|sk_live_[A-Za-z0-9]{16,})\b/g],
 ['private key',/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
 ['embedded URL password',/\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:@]+:[^\s/@]+@/g],
 ['credential assignment',/(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|_authToken)\s*["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi],
 ['npm auth value',/(?:_authToken|_auth|_password)\s*=\s*[^$\s][^\r\n]{7,}/gi]
];
const sensitivePath=/(?:^|\/)(?:\.env(?:\.(?!example$|template$).*)?|\.aws|\.ssh|\.dev-data|\.cache|node_modules|data|backups|exports|logs)(?:\/|$)|\.(?:pem|key|p12|pfx|keystore|db|sqlite3?|zip|exe|msi)(?:$|-)/i;
const findings=[];let bytes=0;
for(const file of files){
 if(sensitivePath.test(file))findings.push({file,rule:'excluded/sensitive file path'});
 if(mode==='working'&&!fs.existsSync(file))continue;
 const buffer=mode==='staged'?execFileSync('git',['show',':'+file],{maxBuffer:16*1024*1024}):fs.readFileSync(file);bytes+=buffer.length;
 if(buffer.includes(0)){findings.push({file,rule:'binary file requires review'});continue;}
 const text=buffer.toString('utf8');
 for(const [rule,pattern] of rules){
  for(const match of text.matchAll(pattern)){
   const value=match[1]??'';
   if(value&&/^(?:YOUR_|REPLACE_|EXAMPLE_|placeholder|\$\{|process\.env\.)/i.test(value))continue;
   findings.push({file,line:text.slice(0,match.index).split('\n').length,rule});
  }
 }
}
console.log(JSON.stringify({mode,files:files.length,bytes,findings},null,2));
if(findings.length)process.exitCode=1;
