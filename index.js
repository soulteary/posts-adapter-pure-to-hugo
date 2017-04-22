#!/usr/bin/env node

'use strict';

const blackList = [
  '.DS_Store',
  '.git',
  '.gitignore',
  'README.json',
  'README.md'
];

const fs = require('fs');
const path = require('path');
const charset = 'utf-8';

let fileCount = 0;

const log = require('./log');
const log4scanDirs = log('scanDirs');
const log4matchMeta = log('matchMeta');
const log4makeHeader = log('makeHeader');
const log4process = log('process');

function scanDirs(baseDir, callback) {
  fs.readdir(baseDir, {encoding: charset}, function(err, dirList) {
    dirList = dirList
        .filter(itemName => blackList.indexOf(itemName) === -1)
        .map(itemName => `${baseDir}/${itemName}`);
    dirList.forEach(function(itemName) {
      fs.stat(itemName, function(err, stats) {
        if (stats.isDirectory()) {
          return scanDirs(itemName, callback);
        } else if (stats.isFile()) {
          if (itemName.slice(-3) === '.md') {
            return callback(itemName);
          }
        } else {
          log4scanDirs.error('unknown error', itemName);
        }
      });
    });
  });
}

function matchMeta(file) {
  const meta = file.slice(0, -3) + '.json';
  fs.stat(meta, function(err, stats) {
    if (err || !stats.isFile()) {
      log4matchMeta.warn(`[${fileCount}][LOSE] meta json file: ${file}`);
    } else {
      fileCount++;
      // if (fileCount > 3) {
      // process.exit(0)
      // } else {
      process(meta, file, fileCount);
      log4matchMeta.log(`[${fileCount}] ${file}`);
      // }
    }
  });
}

function makeHeader(data) {
  try {

    let header = JSON.parse(data);
    let tpl = [];
    tpl.push('---');
    tpl.push(`title: "${header.title}"`);
    tpl.push(`description: "${header.description}"`);
    if (header.tag) {
      tpl.push(`tags: [${JSON.stringify(header.tag).slice(1, -1)}]`);
    }
    tpl.push(`lastmod: "${header.date}"`);
    tpl.push(`date: "${header.date}"`);
    if (header.cate && header.cate.length) {
      tpl.push(`categories: `);
      for (let i = 0, j = header.cate.length; i < j; i++) {
        tpl.push(`    - "${header.cate[i]}"`);
      }
    }
    if (header.alias) {
      tpl.push(`aliases: ${header.alias}`);
    }

    if (header.status) {
      tpl.push(`draft: ${header.status != 'published'}`);
    }

    tpl.push(`isCJKLanguage: true`);

    tpl.push(`slug: ${header.slug}`);
    tpl.push('---');

// @todo 未使用meta info
// {
//     "image": null,
//     "page": 0,
// }

// @todo 数据可用和数据失真
// "date": "Sun, 26 Aug 2007 09:27:27 +0000",
// "dataFormated": "2007/08/26",

    return tpl.join('\n') + '\n\n';
  } catch (e) {
    log4makeHeader.error(`[error] make header ${e}`);
    return false;
  }
}

function process(meta, file, idx) {
  fs.readFile(meta, charset, function(err, metaConetnt) {
    fs.readFile(file, charset, function(err, fileContent) {

      let targetPath = path.dirname(file).replace('..', '.');
      let targetDirs = targetPath.split('/');
      targetDirs = targetDirs
          .map((item, idx) => {
            return targetDirs.slice(0, idx + 1).join('/');
          })
          .filter(item => item && item !== '.');

      targetDirs.forEach(function(dirPath) {
        if (!fs.existsSync(dirPath)) {
          return fs.mkdirSync(dirPath);
        }
      });


      let content = makeHeader(metaConetnt) + fileContent;
      let finalPath = `${targetPath}/${path.basename(file)}`;

      if (content) {
        fs.writeFile(finalPath, content, charset, function(err, result) {
          if (err) {
            log4process.error(`write file error: ${file}`);
            return;
          }
          log4process.log(`[${idx}][done] ${finalPath}`);
        });
      } else {
        log4process.warn(`[${idx}][NEED META] ${file}`);
      }
    });
  });
}

scanDirs('../My-Blog-Posts', matchMeta);