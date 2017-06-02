#!/usr/bin/env node

'use strict';

const fs = require('fs');
const {readdir, stat, readFile, writeFile, existsSync, mkdirSync} = require('fs');

const path = require('path');
const config = require('./config.json');

// 忽略文件列表、文件编码、调试模式
const {blackList, charset, debug} = config;

const log = require('./lib/log');
const log4scanDirs = log('scanDirs');
const log4matchMeta = log('matchMeta');
const log4makeHeader = log('makeHeader');
const log4process = log('process');

const request = require('request');
const querystring = require('querystring');

// todo enable useCodeHighlight feature
module.exports = function (sourceDirPath, distDirPath, useCodeHighlight) {

    let categoriesStatistics = {result: []};
    let fileCount = 0;

    const sourceDir = path.relative('.', sourceDirPath);
    const distDir = distDirPath ? distDirPath : path.join('./export', path.basename(sourceDir));

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


    /**
     * 通过JSON内容生成文章头部数据信息
     *
     * @todo hugo未来会对这种内容支持越来越完善，但是有许多内容还是需要自己定制处理
     * @param data
     * @returns {*}
     */
    function generatePostHeaderMeta(data) {
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
            if (header.categories) {
                tpl.push(`topics: [${JSON.stringify(header.categories.map(function (item) {
                    return item.name;
                })).slice(1, -1)}]`);

                header.categories.map(function (item) {
                    if (!categoriesStatistics[item.slug]) {
                        categoriesStatistics[item.slug] = true;
                        console.log(item);
                    }
                });
            }

            tpl.push(`created: "${header.created_at}"`);
            tpl.push(`updated: "${header.updated_at}"`);

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
                const CodeWithLang = source.match(/```(\w+)\n([\s\S\n]+?)\n```/);

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
                    const postData = querystring.stringify({
                        'code': lang ? `[crayon lang=${lang}]\n${code}\n[/crayon]\n` : `[crayon]\n${code}\n[/crayon]\n`
                    });
                    request.post({
                        url: 'http://127.0.0.1:1234/',
                        form: postData
                    }, function (err, httpResponse, body) {
                        if (err) {
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

                    Promise.all([generatePostHeaderMeta(metaContent), codeParser(fileContent)]).then(function (contents) {
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
