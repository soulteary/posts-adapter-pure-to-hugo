#!/usr/bin/env node

'use strict';

// 非高频使用，使用*sync api取代async api
const {existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync} = require('fs');
const {basename, extname, dirname, join, relative} = require('path');
const {createHmac} = require('crypto');
const {execSync} = require('child_process');
const {stringify} = require('querystring');

const config = require('./config.json');
const pkg = require('./package');

// 忽略文件列表、文件编码、调试模式
const {blackList, charset, debug, timezone, cache} = config;

const moment = require('moment');
const momentTimezone = require('moment-timezone');

const log = require('./lib/log');
const log4scanDirs = log('scanDirs');
const log4matchMeta = log('matchMeta');
const log4makeHeader = log('makeHeader');
const log4process = log('process');

const {post} = require('request');

const {showCategory} = debug;

/**
 * 计算文件Hash
 * @param data
 * @returns {string}
 */
function sign(data) {
  return createHmac('md5', data).digest('hex');
}

/**
 * 目录过滤器
 * @param targetDirs
 */
function dirFilter(targetDirs) {
  return targetDirs.map((item, idx) => targetDirs.slice(0, idx + 1).join('/')).filter(item => item && item !== '.');
}

/**
 * 扫描指定目录的文件
 * @param dirPath     目录位置
 * @param ext         文件类型（可选）
 * @returns {Array}   带目录结构的数组
 */
function getAllFiles(dirPath, ext) {

  function scanDir(dirPath, ext) {
    const result = readdirSync(dirPath);
    if (!result.length) return [];
    return result.filter(name => !(blackList || []).includes(name)).map((dirName) => {
      const filePath = join(dirPath, dirName);
      if (statSync(filePath).isDirectory()) {
        return scanDir(join(dirPath, dirName), ext);
      } else {
        if (!ext) return filePath;
        if (filePath.lastIndexOf(ext) === filePath.indexOf(ext) && filePath.indexOf(ext) > -1) {
          return filePath;
        }
        return '';
      }
    });
  }

  function flatten(arr) {
    return arr.reduce(function(flat, toFlatten) {
      return flat.concat(Array.isArray(toFlatten) ? flatten(toFlatten) : toFlatten);
    }, []);
  }

  return flatten(scanDir(dirPath, ext)).filter(file => file);
}

/**
 * 使用文件后缀过滤文件
 *
 * @example filterFilesByExt([], '.md')
 * @param fileList
 * @param ext
 * @returns {*}
 */
function filterFilesByExt(fileList, ext) {
  return fileList.filter((name) => extname(name) === ext);
}

/**
 * 转换文章内的代码片段
 * @param source
 * @param useCodeHighlight
 * @returns {Promise}
 */
function codeParser(source, useCodeHighlight) {
  return new Promise(function(mainResolve) {
    if (useCodeHighlight) {

      const CodeWithoutLang = source.match(/```\n([\s\S\n]+?)\n```/);
      const CodeWithLang = source.match(/```(\S+)\n([\s\S\n]+?)\n```/);

      let lang = '';
      let code = '';
      let originText = '';

      if (CodeWithLang) {
        originText = CodeWithLang[0];
        lang = CodeWithLang[1];
        code = CodeWithLang[2];
      } else if (CodeWithoutLang) {
        originText = CodeWithoutLang[0];
        code = CodeWithoutLang[1];
      } else {
        originText = '';
        lang = '';
        code = '';
      }
      return code ? mainResolve(new Promise(function(resolve, reject) {
        const postData = {'code': lang ? `[crayon lang=${lang}]\n${code}\n[/crayon]\n` : `[crayon]\n${code}\n[/crayon]\n`};
        post({url: config.codeHighLight.api, form: stringify(postData)}, function(err, httpResponse, body) {
          if (err) {
            console.log(err);
            console.log(postData);
            return reject(err);
          }
          return resolve(codeParser(source.replace(originText, '{{<crayonCode>}}\n' + body + '\n{{</crayonCode>}}')));
        });
      })) : mainResolve(source);
    } else {
      return mainResolve(source);
    }
  });
}

if (!existsSync(cache.database)) writeFileSync(cache.database, '{}');
if (!existsSync(cache.rootDir)) mkdirSync(cache.rootDir);

// todo cli invoke compatibility
module.exports = (sourceDirPath, distDirPath, useCodeHighlight) => {

  let cacheData;
  try {
    cacheData = require(cache.database);
  } catch (e) {
    cacheData = {};
    console.error('读取缓存文件失败。');
  }

  let categoriesStatistics = {result: []};
  let fileCount = 0;

  const sourceDir = relative('.', sourceDirPath);

  function generateDesc(fileContent) {
    /**
     * 修正最后一行内容
     * @param descResult
     * @returns {*}
     */
    function fixLastLine(descResult) {
      const lastLineNumber = descResult.length - 1;
      const lastLine = descResult[lastLineNumber];

      if (!lastLine) return [];

      const lastWord = lastLine[lastLine.length - 1].trim();

      if (lastLine.endsWith('诸如:') || lastLine.endsWith('诸如：')) {
        // 将诸如结尾的内容干掉
        descResult[lastLineNumber] = lastLine.substr(0, lastLine.lastIndexOf('诸如'));
      } else if (['：', ':'].indexOf(lastWord) > -1) {
        // 长段落内容最后结尾是冒号，替换为省略号。
        descResult[lastLineNumber] = lastLine.substr(0, lastLine.length - 1) + '...';
      } else if (lastLine.lastIndexOf('。') > -1 && lastLine.lastIndexOf('。') !== lastWord) {
        // 句号后还有内容，直接抛弃。
        descResult[lastLineNumber] = lastLine.substr(0, lastLine.lastIndexOf('。') + 1);
      } else {
        // todo 待完善
        // console.log('[---]', '未被处理的lastLine');
        // console.log(lastLine);
      }
      return descResult;
    }

    /**
     * 获取描述内容
     * @param descResult
     * @returns {string}
     */
    function getResult(descResult) {
      // console.log(descResult);

      if (!descResult.length) return '';

      let result = fixLastLine(descResult);

      if (result.length > 3) {
        result = result.slice(0, 3).join('');
      } else {
        result = result.join('');
      }

      result = result.
          replace(/<em>/g, '').
          replace(/<\/em>/g, '').
          replace(/<strong>/g, '').
          replace(/<\/strong>/g, '');

      return result;
    }

    let fileLines = fileContent ? fileContent.split('\n') : [];
    let descResult = [];
    let hasSkipHeadline = false;

    if (!fileLines.length) return getResult(descResult);

    for (let i = 0, j = fileLines.length; i < j; i++) {
      const line = fileLines[i];
      // console.log(`${i} | ${line}`);

      // 获取两个标题内的内容
      if (line.match(/\s*?(#)+[\s\S]+/)) {
        if (hasSkipHeadline) getResult(descResult);
        hasSkipHeadline = true;
      } else if (line.match(/^`{3}/)) {
        // 跳过代码
        return getResult(descResult);
      } else if (line.match(/^\s*?$/)) {
        // 跳过空行
      } else if (line.match(/\s*?>\s+\*/)) {
        // 跳过引用
        return getResult(descResult);
      } else if (line.match(/\s*?(\*|\-)\s+/)) {
        // 跳过列表
        return getResult(descResult);
      } else if (line.match(/\s*?\d+\.\s+/)) {
        // 跳过数字列表
        return getResult(descResult);
      } else if (line.match(/\s*?\|.+\|/)) {
        // 跳过表格
        return getResult(descResult);
      } else if (line.match(/\s*?>.*]/)) {
        // 跳过块引用
        return getResult(descResult);
      } else {
        let saveLine = line
        // strip
            .replace(/^\s+|\s+$/, '')
            // 去除链接文本的图片
            .replace(/\[!\[.+\]\(.+\)/g, '')
            // 摘出链接文本
            .replace(/\[([\s\S]+?)\]\(.*?\)/g, '[$1]')
            // 剔除图片
            .replace(/!\[.*\]\(.*\)/g, '')
            // 剔除``行内代码
            .replace(/`(.+?)`/g, '$1')
            // 干掉首行的块引用
            .replace(/^>\s+/, '')
            // 干掉**加粗
            .replace(/\*\*\*(.*?)\*\*\*/g, '$1').replace(/\*\*(.*?)\*\*/g, '$1')
            // 去掉ins标签
            .replace(/<ins\s\S+>(.+?)<\/ins>/, '$1');

        if (!line.match(/http:\/\//)) {
          // 替换正则为字符串，hugo bug
          saveLine = saveLine.replace(/(\W+)\/.*\/\w+(\W+)/, '$1正则$2');
        }
        // 将其他内容保存
        if (saveLine) {
          descResult.push(saveLine);
        }
      }
    }

    return getResult(descResult);
  }

  /**
   * 获取文件hash
   * @param pathToFile
   * @returns {Array}
   */
  // todo
  function revision(pathToFile) {
    var data = execSync(`cd ${dirname(pathToFile)};git log -n 1 --pretty=format:'%h\n%s' "${basename(pathToFile)}"`).toString().trim();
    try {
      return data;
    } catch (e) {
      return [];
    }
  }

  /**
   * 生成文章信息内容模板
   * @param data
   * @param fileContent
   * @param src
   * @returns {*}
   */
  function generatePostMetaTemplate(data, fileContent, src) {

    let header;

    try {
      header = JSON.parse(data);
    } catch (e) {
      log4makeHeader.error(`[error] make header ${e}`);
      return Promise.resolve(false);
    }

    let tpl = [];
    tpl.push('---');
    tpl.push(`title: "${header.title}"`);
    if (header.description) {
      tpl.push(`description: "${header.description}"`);
    } else {
      tpl.push(`description: "${generateDesc(fileContent)}"`);
    }
    if (header.tag) {
      tpl.push(`tags: [${JSON.stringify(header.tag).slice(1, -1)}]`);
    }

    const dateA = moment(header.date).tz(timezone).format('YYYY-MM-DDTHH:mm:ssZ');
    const dateB = moment(header.created_at).tz(timezone).format('YYYY-MM-DDTHH:mm:ssZ');
    const dateC = moment(header.updated_at).tz(timezone).format('YYYY-MM-DDTHH:mm:ssZ');

    // 以建日期为准
    if (new Date(header.date) > new Date(header.created_at)) {
      tpl.push(`date: "${dateB}"`);
    } else {
      tpl.push(`date: "${dateA}"`);
    }

    tpl.push(`lastmod: "${dateA}"`);
    tpl.push(`created: "${dateB}"`);
    tpl.push(`updated: "${dateC}"`);
    tpl.push(`dateForChinese: "${moment(header.created_at).format('YYYY年MM月DD日')}"`);

    if (header.categories) {
      let catData = header.categories.map((item) => item.slug);

      tpl.push(`topics: ${JSON.stringify(catData)}`);

      header.categories.map((item) => {
        if (!categoriesStatistics[item.slug]) {
          categoriesStatistics[item.slug] = true;
          if (showCategory) console.log(item);
        }
      });
    }

    if (header.alias) {
      if (typeof header.alias === 'string') {
        tpl.push(`aliases:`);

        let baseURI = '/';

        if (header.dataFormated) {
          baseURI = `/${header.dataFormated}/`;
        }

        if (header.alias.indexOf('/') === 0) {
          tpl.push(`    - ${baseURI}${header.alias}`);
          tpl.push(`    - ${baseURI}${header.alias}.html`);
        } else {
          tpl.push(`    - ${baseURI}${header.alias}`);
          tpl.push(`    - ${baseURI}${header.alias}.html`);
        }
      }
    }

    if (header.status) {
      tpl.push(`draft: ${header.status !== 'published'}`);
    }

    tpl.push(`isCJKLanguage: true`);

    var gitInfo = revision(src).split('\n');
    if (gitInfo[0]) {
      tpl.push(`gitComment: "${gitInfo[0]}"`);
      tpl.push(`gitFile: "${src}"`);
    }
    if (gitInfo[1]) {
      tpl.push(`gitLabel: "${gitInfo[1]}"`);
    }

    tpl.push(`slug: "${header.slug}"`);
    tpl.push('---');

    // @todo 处理暂时未使用meta info
    // {
    //     "image": null,
    //     "page": 0,
    // }

    // @todo 数据可用和数据失真
    // "date": "Sun, 26 Aug 2007 09:27:27 +0000",
    // "dataFormated": "2007/08/26",

    return Promise.resolve(tpl.join('\n') + '\n\n');

  }

  /**
   * 生成文章内容
   * @param params
   * @returns {Promise<any>}
   */
  function mixParsedContent(params) {

    const {metaContent, postContent, postFile, distFile, idx} = params;

    return new Promise(function(resolve, reject) {

      dirFilter(distFile.split('/').slice(0, -1)).forEach((dirPath) => {
        if (!existsSync(dirPath)) return mkdirSync(dirPath);
      });

      Promise.
          all([
            generatePostMetaTemplate(metaContent, postContent, postFile),
            codeParser(postContent, useCodeHighlight),
          ]).then(function(contents) {

        if (contents.length === 2 && contents[0] && contents[1]) {
          let content = contents.join('');
          if (content) {

            try {
              writeFileSync(distFile, content, {encoding: charset});
              fileCount++;
              const message = `[${(fileCount / allPostFiles.length * 100).toFixed(2)}%] [${idx}] [done] ${distFile}`;
              log4process.log(message);
              return resolve(message);
            } catch (e) {
              const error = `write file error: ${postFile}`;
              log4process.error(error);
              return reject(error);
            }
          } else {
            const message = `[${idx}] [NEED META] ${postFile}`;
            log4process.warn(message);
            return resolve(message);
          }
        }

      }).catch((error) => reject(error));
    });
  }

  /**
   * 开始处理流程
   */

  const allFiles = getAllFiles(sourceDir);
  const allPostFiles = filterFilesByExt(allFiles, '.md');
  const allCachedFiles = filterFilesByExt(getAllFiles(cache.rootDir), '.md');

  // 扫描目录存在的md文件
  if (allPostFiles.length === 0) {
    log4scanDirs.warn('指定目录未发现`.md`文件');
    process.exit(1);
  }

  // 检查是否存在缓存与数据源不一致的情况
  const willCachedFiles = allPostFiles.map((file) => join(cache.rootDir, file.replace(/\.\.\//g, '')));
  const willDeleteFiles = allCachedFiles.filter((file) => !willCachedFiles.includes(file));

  if (willDeleteFiles.length) {
    console.log('清理缓存目录中过期的文件', willDeleteFiles);
    willDeleteFiles.forEach((file) => unlinkSync(file));
  }

  // 检查是否有存在缺少元文件的文档
  const postsWithoutMetaFile = allPostFiles.
      map((name) => `${dirname(name)}/${basename(name, '.md')}.json`).filter((name) => !existsSync(name));
  if (postsWithoutMetaFile.length) {
    log4matchMeta.error('存在缺失Meta文件的文章', postsWithoutMetaFile);
    process.exit(1);
  }

  // 检查是否有多余的元文件
  const metaFilesWithoutPostFile = filterFilesByExt(allFiles, '.json').
      map((name) => `${dirname(name)}/${basename(name, '.json')}.md`).filter((name) => !existsSync(name));
  if (postsWithoutMetaFile.length) {
    log4matchMeta.error('存在多余的MetaFiles', metaFilesWithoutPostFile);
    process.exit(2);
  }

  // 开始处理文件
  allPostFiles.forEach((postFile, idx) => {

    const postContent = readFileSync(postFile, charset);
    const metaFile = `${dirname(postFile)}/${basename(postFile, '.md')}.json`;
    const metaContent = readFileSync(metaFile, charset);
    const distFile = join(cache.rootDir, postFile.replace(/\.\.\//g, '')).replace(/^\//g, '');

    const checksum = sign(`${postContent}\n${pkg.version}\n${metaContent}`);

    if (cacheData.hasOwnProperty(distFile) && cacheData[distFile] === checksum) {
      fileCount++;
      return log4process.log(`[${(fileCount / allPostFiles.length * 100).toFixed(2)}%] [跳过处理] ${postFile}`);
    }

    cacheData[distFile] = checksum;
    return mixParsedContent({metaContent, postContent, postFile, distFile, idx});
  });

  writeFileSync(cache.database, JSON.stringify(cacheData));
};
