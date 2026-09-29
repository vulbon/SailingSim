#!/usr/bin/env node
// 把 src/ 裡的三個檔案組成單一的 index.html。
// 用法：node build.js   （或 npm run build）
// 改完 src/physics.js、src/main.js 或 src/template.html 之後執行一次即可。
const fs = require('fs');
const path = require('path');

const src = (name) => fs.readFileSync(path.join(__dirname, 'src', name), 'utf8');
const template = src('template.html');
const physics = src('physics.js');
const main = src('main.js');

// 用函式當取代值，避免程式碼裡的 $&、$' 等字串被 String.replace 當成特殊符號
const html = template.replace('/*PHYSICS*/', () => physics).replace('/*MAIN*/', () => main);
fs.writeFileSync(path.join(__dirname, 'index.html'), html, 'utf8');
console.log(`index.html 已產生（${(Buffer.byteLength(html) / 1024).toFixed(0)} KB）`);
