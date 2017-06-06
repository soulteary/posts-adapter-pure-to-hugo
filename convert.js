#!/usr/bin/env node

'use strict';

const fs = require('fs');
const {readdir, stat, readFile, writeFile, existsSync, mkdirSync} = require('fs');

const path = require('path');
const config = require('./config.json');

// 忽略文件列表、文件编码、调试模式
const {blackList, charset, debug} = config;

const moment = require('moment');

const log = require('./lib/log');
const log4scanDirs = log('scanDirs');
const log4matchMeta = log('matchMeta');
const log4makeHeader = log('makeHeader');
const log4process = log('process');

const request = require('request');
const querystring = require('querystring');

const showCategory = false;

// todo enable useCodeHighlight feature
module.exports = function (sourceDirPath, distDirPath, useCodeHighlight) {

    let categoriesStatistics = {result: []};
    let fileCount = 0;

    const sourceDir = path.relative('.', sourceDirPath);
    const distDir = distDirPath ? `${distDirPath}/post` : path.join('./export', path.basename(sourceDir));

    /**
     * 文件过滤器
     *
     * @desc 过滤并拼合正确的路径
     * @param dirList
     * @param baseDir
     */
    function fileFilter(dirList, baseDir) {
        return dirList
            .filter(itemName => blackList.indexOf(itemName) === -1)
            .map(itemName => `${baseDir}/${itemName}`);
    }


    /**
     * 目录过滤器
     * @param targetDirs
     */
    function dirFilter(targetDirs) {
        return targetDirs
            .map((item, idx) => targetDirs.slice(0, idx + 1).join('/'))
            .filter(item => item && item !== '.');
    }


    /**
     * 目录扫描
     *
     * @param baseDir
     * @param distDir
     * @param multipleProcessor
     * @returns {Promise}
     */
    function scanDirs(baseDir, distDir, multipleProcessor) {
        return new Promise(function (mainResolve, mainReject) {
            readdir(baseDir, {encoding: charset}, function (err, dirList) {
                if (err) {
                    return mainReject(err);
                }

                return mainResolve(
                    fileFilter(dirList, baseDir).reduce(function (promiseFactory, itemName) {
                        return promiseFactory.then(function () {
                            return new Promise(function (subResolve, subReject) {
                                stat(itemName, function (readDirError, stats) {
                                    if (err) {
                                        return subReject(readDirError);
                                    }
                                    if (stats.isDirectory()) {
                                        return subResolve(scanDirs(itemName, distDir, multipleProcessor));
                                    } else if (stats.isFile()) {
                                        if (itemName.slice(-3) === '.md') {
                                            return subResolve(multipleProcessor.reduce(function (subPromiseFactory, preProcessor) {
                                                const src = itemName;
                                                const dist = path.join(distDir, path.relative(sourceDir, itemName));
                                                return subPromiseFactory.then(preProcessor(src, dist));
                                            }, Promise.resolve()));
                                        } else {
                                            return subResolve();
                                        }
                                    } else {
                                        const error = 'unknown error';
                                        log4scanDirs.error(error, itemName);
                                        return subReject(error);
                                    }
                                });
                            });
                        });
                    }, Promise.resolve())
                );

            });
        });
    }


    /**
     * 检查是否有匹配的数据文件
     *
     * @param src
     * @param dist
     * @returns {Promise}
     */
    function matchMeta(src, dist) {
        const meta = src.slice(0, -3) + '.json';
        return new Promise(function (resolve, reject) {
            stat(meta, function (err, stats) {
                if (err || !stats.isFile()) {
                    const error = `[${fileCount}][LOSE] meta json file: ${src}`;
                    log4matchMeta.warn(error);
                    return reject(error)
                } else {
                    fileCount++;
                    if (!(debug.enable && fileCount > debug.maxFilesCount)) {
                        log4matchMeta.log(`[${fileCount}] ${src}`);
                        return generatePostContent(meta, src, dist, fileCount);
                    } else {
                        return resolve();
                    }
                }
            });
        });
    }


    function generateDesc(fileContent) {
        /**
         * 修正最后一行内容
         * @param descResult
         * @returns {*}
         */
        function fixLastLine(descResult) {
            const lastLineNumber = descResult.length - 1;
            const lastLine = descResult[lastLineNumber];
            if (!lastLine) {
                return [];
            }
            const lastWord = lastLine[lastLine.length - 1];

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
                console.log('[---]', '未被处理的lastLine');
                console.log(lastLine);
            }
            return descResult;
        }

        /**
         * 获取描述内容
         * @param descResult
         * @returns {string}
         */
        function getResult(descResult) {
            if (descResult.length) {
                let result = fixLastLine(descResult);
                if (result.length > 3) {
                    return result.slice(0, 3);
                } else {
                    return result;
                }
            } else {
                return '';
            }
        }

        let fileLines = fileContent ? fileContent.split('\n') : [];
        let descResult = [];
        let hasSkipHeadline = false;
        if (!fileLines.length) {
            return getResult(descResult);
        }
        for (let i = 0, j = fileLines.length; i < j; i++) {
            const line = fileLines[i];
            // 获取两个标题内的内容
            if (line.match(/\s*?(#)+[\s\S]+/)) {
                if (hasSkipHeadline) {
                    return getResult(descResult);
                }
                hasSkipHeadline = true;
            } else if (line.match(/\s*?`{3}/)) {
                // 跳过代码
                return getResult(descResult);
            } else if (line.match(/^\s*?$/)) {
                // 跳过空行
            } else if (line.match(/\s*?>\s+\*/)) {
                // 跳过引用
                return getResult(descResult);
            } else if (line.match(/\s*?[\*\-]\s+/)) {
                // 跳过列表
                return getResult(descResult);
            } else if (line.match(/\s*?|.*|/)) {
                // 跳过表格
                return getResult(descResult);
            } else if (line.match(/\s*?>.*]/)) {
                // 跳过块引用
                return getResult(descResult);
            } else {
                // 将其他内容保存
                descResult.push(line
                    // strip
                        .replace(/^\s+|\s+$/, '')
                        // 摘出链接文本
                        .replace(/\[([\s\S]+)\]\(.*\)/g, "[$1]")
                        // 剔除图片
                        .replace(/!\[.*\]\(.*\)/g, '')
                );
            }
        }

        return getResult(descResult);
    }

    /**
     * 通过JSON内容生成文章头部数据信息
     *
     * @todo hugo未来会对这种内容支持越来越完善，但是有许多内容还是需要自己定制处理
     * @param data
     * @param fileContent
     * @returns {*}
     */
    function generatePostHeaderMeta(data, fileContent) {
        try {
            let header = JSON.parse(data);
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
            tpl.push(`lastmod: "${header.date}"`);
            tpl.push(`date: "${header.date}"`);
            if (header.categories) {

                let catData = header.categories.map(function (item) {
                    if (item.slug && item.slug.indexOf('knowledge') > -1) {


                        const catsMap = {
                            'knowledge/backend-knowledge': [
                                'knowledge/backend-knowledge',
                                'knowledge/c-learning',
                                'knowledge/php-learning',
                                'knowledge/asp-learning',
                                'knowledge/sql'
                            ],
                            'knowledge/system-knowledge': [
                                'knowledge/system-knowledge',
                                'knowledge/dos-learning',
                                'knowledge/windows-learning',
                                'knowledge/linux-learning',
                                'system-knowledge'
                            ],
                            'knowledge/frontend-knowledge': [
                                'knowledge/frontend-knowledge',
                                'knowledge/web-learning',
                                'knowledge/javascript-learning',
                                'knowledge/css-learning',
                                'knowledge/html-learning'
                            ],
                            'knowledge/desktop-knowledge': [
                                'knowledge/desktop-knowledge',
                                'desktop-knowledge',
                                'knowledge/vb-learning'
                            ],
                            'knowledge/reference-room': [
                                'knowledge/reference-room'
                            ]
                        };

                        Object.keys(catsMap).forEach(function (label) {
                            if (catsMap[label].indexOf(item.slug) > -1) {
                                item.slug = label;
                            }
                        });

                        if (Object.keys(catsMap).indexOf(item.slug) === -1 &&
                            ['knowledge'].indexOf(item.slug) === -1) {
                            console.log(item);
                        }
                    } else if (['leisure-moment'].indexOf(item.slug) > -1) {
                        item.slug = 'share/leisure-moment';
                    }

                    return item.slug;
                });

                tpl.push(`topics: ${JSON.stringify(catData)}`);

                header.categories.map(function (item) {
                    if (!categoriesStatistics[item.slug]) {
                        categoriesStatistics[item.slug] = true;
                        if (showCategory) {
                            console.log(item);
                        }
                    }
                });
            }

            tpl.push(`created: "${header.created_at}"`);
            tpl.push(`updated: "${header.updated_at}"`);
            moment.locale('zh-cn');
            tpl.push(`dateForChinese: "${moment().format('L')}"`);

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
        } catch (e) {
            log4makeHeader.error(`[error] make header ${e}`);
            return Promise.resolve(false);
        }
    }

    /**
     * 转换文章内的代码片段
     * @param source
     * @returns {Promise}
     */
    function codeParser(source) {
        return new Promise(function (mainResolve) {
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
                return code ? mainResolve(new Promise(function (resolve, reject) {
                    const postData = {
                        'code': lang ? `[crayon lang=${lang}]\n${code}\n[/crayon]\n` : `[crayon]\n${code}\n[/crayon]\n`
                    };
                    request.post({
                        url: 'http://127.0.0.1:1234/',
                        form: querystring.stringify(postData)
                    }, function (err, httpResponse, body) {
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


    /**
     * 生成文章内容
     *
     * @param meta
     * @param src
     * @param dist
     * @param idx
     * @returns {Promise}
     */
    function generatePostContent(meta, src, dist, idx) {

        return new Promise(function (resolve, reject) {
            readFile(meta, charset, function (err, metaContent) {
                readFile(src, charset, function (err, fileContent) {

                    dirFilter(dist.split('/').slice(0, -1)).forEach(function (dirPath) {
                        if (!existsSync(dirPath)) {
                            return mkdirSync(dirPath);
                        }
                    });

                    Promise.all([generatePostHeaderMeta(metaContent, fileContent), codeParser(fileContent)]).then(function (contents) {
                        if (contents.length === 2 && contents[0] && contents[1]) {
                            let content = contents.join('');

                            if (content) {
                                writeFile(dist, content, charset, function (err) {
                                    if (err) {
                                        const error = `write file error: ${src}`;
                                        log4process.error(error);
                                        return reject(error);
                                    }
                                    const message = `[${idx}][done] ${dist}`;
                                    log4process.log(message);
                                    return resolve(message);
                                });
                            } else {
                                const message = `[${idx}][NEED META] ${src}`;
                                log4process.warn(message);
                                return resolve(message);
                            }
                        }
                    }).catch(function (error) {
                        return reject(error);
                    });

                });
            });
        });
    }


    scanDirs(sourceDir, distDir, [matchMeta]).then(function (error) {
        return error ? console.log(`${error}`) : console.log('done.');
    }).catch(function (error) {
        console.log('error', error)
    });

};
