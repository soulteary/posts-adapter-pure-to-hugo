#!/usr/bin/env node

'use strict';

// 非高频使用，使用*sync api取代async api
const {existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync} = require('fs');
const {basename, extname, dirname, join, relative} = require('path');
const {execSync} = require('child_process');
const {stringify} = require('querystring');
const {chunk} = require('lodash');

const hljs = require('highlight.js');
// 4个空格？如果存在eslint，可以去掉
hljs.configure({tabReplace: '    ', classPrefix: 'hljs-'});

const eslint = require('eslint');
const linter = new eslint.Linter();

const {getAllFiles, md5} = require('./helper');

const config = require('./config.json');
const pkg = require('./package');

// 忽略文件列表、文件编码、调试模式
const {blackList, charset, debug, timezone, cache, concurrence, codeHighlight} = config;

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
 * 目录过滤器
 * @param targetDirs
 */
function dirFilter(targetDirs) {
  return targetDirs.map((item, idx) => targetDirs.slice(0, idx + 1).join('/')).filter((item) => item && item !== '.');
}

/**
 * 使用文件后缀过滤文件
 *
 * @example filterFilesByExt([], '.md')
 * @param fileList
 * @param ext
 * @return {*}
 */
function filterFilesByExt(fileList, ext) {
  return fileList.filter((name) => extname(name) === ext);
}

/**
 * 获取文件hash
 * @param pathToFile
 * @return {Array}
 */
function revision(pathToFile) {
  try {
    return execSync(`cd ${dirname(pathToFile)};git log -n 1 --pretty=format:'%h\n%s' "${basename(pathToFile)}"`).toString().trim();
  } catch (e) {
    return [];
  }
}

/**
 * 转换文章内的代码片段
 * @param source
 * @return {Promise}
 */
function remoteCodeParser(source) {
  // 递归处理当前数据中的高亮代码
  // 优先处理定义语言类型的段落块，避免匹配方式查找出错
  return new Promise((resolve, reject) => {
    const CodeTypeDefined = source.match(/```(\S+)\n([\s\S\n]+?)\n```+?/);
    const CodeTypeUndefined = source.match(/```\n([\s\S\n]+?)\n```+?/);

    let originText;
    let lang;
    let code;

    if (CodeTypeDefined) {
      [originText, lang, code] = CodeTypeDefined;
    } else if (CodeTypeUndefined) {
      // lang 注定不存在
      [originText, code, lang] = CodeTypeUndefined;
    } else {
      // 查找不到匹配内容，返回传入数据
      return resolve(source);
    }

    if (!code) return resolve(source);

    // todo 清理未明确定义的代码片段
    const postData = {'code': `[crayon lang=${lang ? lang : 'text'}]\n${code}\n[/crayon]\n`};

    post({url: config.codeHighlight.api, form: stringify(postData)}, (err, httpResponse, body) => {
      if (err) {
        console.log('code:', httpResponse && httpResponse.statusCode);
        console.log(err);
        console.log(`-----Invoke Params------`);
        console.log({originText, lang, code});
        console.log(`-----Post Data------`);
        console.log(postData);
        console.log();
        console.log();
        console.log('接口返回不正确，重新渲染', source);
        return resolve(remoteCodeParser(source));
      }

      if (Number(httpResponse.statusCode) !== 200) {
        console.log('接口状态不正确，重新渲染', httpResponse.statusCode);
        return resolve(remoteCodeParser(source));
      }
      return resolve(remoteCodeParser(source.replace(originText, '{{<crayonCode>}}\n' + body + '\n{{</crayonCode>}}')));
    });
  });
}

function codeParser(source) {
  // 递归处理当前数据中的高亮代码
  // 优先处理定义语言类型的段落块，避免匹配方式查找出错
  return new Promise((resolve, reject) => {
    const CodeTypeDefined = source.match(/```(\S+)\n([\s\S\n]+?)\n```+?/);
    const CodeTypeUndefined = source.match(/```\n([\s\S\n]+?)\n```+?/);

    let originText;
    let lang;
    let code;

    if (CodeTypeDefined) {
      [originText, lang, code] = CodeTypeDefined;
    } else if (CodeTypeUndefined) {
      // lang 注定不存在
      [originText, code, lang] = CodeTypeUndefined;
    } else {
      // 查找不到匹配内容，返回传入数据
      return resolve(source);
    }

    let highlightResult;
    if (hljs.getLanguage(lang)) {
      //   var messages = linter.verifyAndFix(code);
      //   console.log(messages);
      //   console.log(getLanguage(lang), lang);
      highlightResult = hljs.highlight(lang, code);
    } else {
      highlightResult = hljs.highlightAuto(code);
    }

    highlightResult = highlightResult.value.split('\n').map((line, idx) => `<div class="hljs-line ${idx % 2 === 0 ? 'hljs-striped-line' : ''}">${line}</div>`).join('\n');
    highlightResult = `<div class="hljs">${highlightResult}</div>`;

    if (!code) return resolve(source);

    return resolve(codeParser(source.replace(originText, '{{<highlightCode>}}' + highlightResult + '\n{{</highlightCode>}}')));
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
     * @return {*}
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
     * @return {string}
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
   * 生成文章信息内容模板
   * @param data
   * @param fileContent
   * @param src
   * @return {*}
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

    let gitInfo = revision(src).split('\n');
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
   * @return {Promise<any>}
   */
  async function mixParsedContent(params) {
    const {metaContent, postContent, postFile, distFile, idx, postsCount} = params;

    dirFilter(distFile.split('/').slice(0, -1)).forEach((dirPath) => {
      if (!existsSync(dirPath)) return mkdirSync(dirPath);
    });

    const metaPart = await generatePostMetaTemplate(metaContent, postContent, postFile);
    const postPart = useCodeHighlight ? codeHighlight.remote ? await remoteCodeParser(postContent) : await codeParser(postContent) : postContent;

    if (!metaPart || !postPart) {
      const error = `文件数据有问题: ${postFile}`;
      log4process.error(error);
      return error;
    }
    let content = [metaPart, postPart].join('');
    if (content) {
      try {
        writeFileSync(distFile, content, {encoding: charset});
        fileCount++;
        const message = `[${(fileCount / postsCount * 100).toFixed(2)}%] [${idx}] [done] ${distFile}`;
        log4process.log(message);
        return message;
      } catch (e) {
        const error = `write file error: ${postFile}`;
        log4process.error(error);
        return error;
      }
    } else {
      const message = `[${idx}] [NEED META] ${postFile}`;
      log4process.warn(message);
      return message;
    }
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
  const postsWithoutMetaFile = allPostFiles.map((name) => `${dirname(name)}/${basename(name, '.md')}.json`).filter((name) => !existsSync(name));
  if (postsWithoutMetaFile.length) {
    log4matchMeta.error('存在缺失Meta文件的文章', postsWithoutMetaFile);
    process.exit(1);
  }

  // 检查是否有多余的元文件
  const metaFilesWithoutPostFile = filterFilesByExt(allFiles, '.json').map((name) => `${dirname(name)}/${basename(name, '.json')}.md`).filter((name) => !existsSync(name));
  if (postsWithoutMetaFile.length) {
    log4matchMeta.error('存在多余的MetaFiles', metaFilesWithoutPostFile);
    process.exit(2);
  }

  // 开始处理文件
  const maxConcurrence = concurrence || 3;
  const allPostFileChunks = chunk(allPostFiles.slice(debug && debug.enable ? debug.maxFilesCount * -1 : 0), maxConcurrence);

  allPostFileChunks.reduce((promiseFactory, jobGroup, jobGroupIdx) => {
    return promiseFactory.then(() => {
      return Promise.all[jobGroup.map(async (postFile, jobIdx) => {
        const postContent = readFileSync(postFile, charset);
        const metaFile = `${dirname(postFile)}/${basename(postFile, '.md')}.json`;
        const metaContent = readFileSync(metaFile, charset);
        const distFile = join(cache.rootDir, postFile.replace(/\.\.\//g, '')).replace(/^\//g, '');
        const contentFingerprint = md5(`${postContent}\n${pkg.version}\n${metaContent}`);

        // 是否重新生成缓存
        let reGenerate = false;

        // 缓存数据库是否有记录
        if (cacheData[distFile]) {
          // 文件存在变动
          if (cacheData[distFile].content !== contentFingerprint) reGenerate = true;
          // 缺少缓存数据库中对应的缓存文件
          if (!existsSync(distFile)) {
            reGenerate = true;
          } else {
            // 缓存文件指纹不正确
            const cacheFingerprint = md5(readFileSync(distFile, charset));
            if (cacheData[distFile].cache !== cacheFingerprint) reGenerate = true;
          }
        } else {
          // 缓存数据库无记录
          reGenerate = true;
        }

        if (reGenerate === false) {
          fileCount++;
          return log4process.log(`[${(fileCount / allPostFiles.length * 100).toFixed(2)}%] [跳过处理] ${postFile}`);
        }

        const idx = jobGroupIdx * maxConcurrence + (jobIdx + 1);
        await mixParsedContent({metaContent, postContent, postFile, distFile, idx, postsCount: allPostFiles.length});

        // 文件处理完毕，统一进行记录
        cacheData[distFile] = cacheData[distFile] || {};
        cacheData[distFile].content = contentFingerprint;
        cacheData[distFile].cache = md5(readFileSync(distFile, charset));
        writeFileSync(cache.database, JSON.stringify(cacheData));
        return true;
      })];
    });
  }, Promise.resolve());

};
