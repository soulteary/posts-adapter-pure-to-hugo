#!/usr/bin/env node

'use strict';

const scandir = require('scandirectory');

const fs = require('fs');
const { readFileSync, writeFileSync, existsSync, mkdirSync} = require('fs');

const path = require('path');

// todo enable useCodeHighlight feature
module.exports = function (sourceDirPath, distDirPath) {

    const sourceDir = path.relative('.', sourceDirPath);
    const distDir = distDirPath ? `${distDirPath}/archives` : path.join('./export', path.basename(sourceDir), 'archives');

    var options = {};

    function completionCallback(err, list, data) {
        if (err) {
            return console.error(err);
        }

        let yearList = Object.keys(data).filter(function (yearDir) {
            return yearDir.match(/^\d{4}/);
        });

        let finalData = {};

        yearList.forEach(function (year) {
            finalData[year] = finalData[year] || {};
            let yearDir = path.join(distDir, year);
            if (!existsSync(yearDir)) {
                mkdirSync(yearDir);
            }
            const monthList = Object.keys(data[year]);
            monthList.forEach(function (month) {
                finalData[year][month] = finalData[year][month] || {};
                let monthDir = path.join(yearDir, month);
                if (!existsSync(monthDir)) {
                    mkdirSync(monthDir);
                }
                const monthData = data[year][month];
                const dayList = Object.keys(monthData);
                dayList.forEach(function (day) {
                    finalData[year][month][day] = monthData[day] || {};
                    // let dayDir = path.join(monthDir, day);
                    // if (!existsSync(dayDir)) {
                    //     mkdirSync(dayDir);
                    // }
                });
            });
        });

        /**
         * 补全并按照desc排列数字
         * @param data
         * @returns {Array}
         */
        function descData(data) {
            return Object.keys(data).map(function (val) {
                return parseInt(val, 10);
            }).sort(function (a, b) {
                return b > a;
            }).map(function (val) {
                let paddingData = '0' + val;
                return paddingData.substring(paddingData.length - 2, paddingData.length);
            });
        }

        function metaData(title, now) {
            return `---
title: "${title}"
description: "${title}, 一个普通程序员的个人博客，沉溺于折腾各种好玩的东西。"
keywords: ["我的文章存档页面"]
lastmod: "${now}"
date: "${now}"
created: "${now}"
updated: "${now}"
type: archives
draft: false
isCJKLanguage: true
outputs: [ "HTML"]
---`
        }


        function generateYearArchive(year, data) {
            const now = 'Tue, 06 Jun 2017 18:33:59 +0800';
            let tpl = [metaData(`${year}年文章存档`, now)];
            let monthTpl = [metaData(`${year}年文章存档`, now)];

            // month data desc
            const monthList = descData(data[year]);
            monthList.forEach(function (month) {
                tpl.push('', `## [${year}年${month}月](/archives/${year}/${month}/)`, '');
                const dayList = descData(data[year][month]);
                dayList.forEach(function (day) {
                    const dayData = data[year][month][day];
                    const dayDir = path.join(sourceDir, year, month, day);
                    Object.keys(dayData).filter(function (file) {
                        return file.endsWith('.json');
                    }).forEach(function (file) {
                        const content = JSON.parse(readFileSync(path.join(dayDir, file)).toString());
                        let {title, slug} = content;
                        tpl.push(`- \`${day}\` [${title}](/${year}/${month}/${day}/${slug}.html)`);
                        monthTpl.push(`- \`${day}\` [${title}](/${year}/${month}/${day}/${slug}.html)`);
                    });
                });
                writeFileSync(path.join(distDir, year, month, 'index.md'), monthTpl.join('\n'));
                writeFileSync(path.join(distDir, year, 'index.md'), tpl.join('\n'));
            });

        }

        Object.keys(finalData).forEach(function (year) {
            if (['2017', '2016'].indexOf(year) > -1) {
                generateYearArchive(year, finalData);
            }
        });
    }

    scandir(sourceDir, {
        ignoreHiddenFiles: true,
        ignoreCustomPatterns: /\d{4}\d{2}/
    }, completionCallback)
};
