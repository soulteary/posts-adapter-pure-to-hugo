#!/usr/bin/env node

'use strict';

const {readFileSync, writeFileSync, existsSync, mkdirSync} = require('fs');
const {basename, join, relative} = require('path');

const scandir = require('scandirectory');

const config = require('./config.json');

// todo enable useCodeHighlight feature
module.exports = (sourceDirPath, distDirPath) => {

  const sourceDir = relative('.', sourceDirPath);
  const distDir = distDirPath ? `${distDirPath}/archives` : join('./export', basename(sourceDir), 'archives');
  if (!existsSync(distDir)) mkdirSync(distDir);

  function completionCallback(err, list, data) {

    if (err) return console.error(err);

    let yearList = Object.keys(data).filter((yearDir) => yearDir.match(/^\d{4}/));

    let finalData = {};

    // 将文章目录进行数据整理
    yearList.forEach((year) => {
      finalData[year] = finalData[year] || {};
      let yearDir = join(distDir, year);
      // if (!existsSync(yearDir)) mkdirSync(yearDir);

      const monthList = Object.keys(data[year]);
      monthList.forEach((month) => {
        finalData[year][month] = finalData[year][month] || {};
        let monthDir = join(yearDir, month);
        // if (!existsSync(monthDir)) mkdirSync(monthDir);

        const monthData = data[year][month];
        const dayList = Object.keys(monthData);
        dayList.forEach((day) => {
          finalData[year][month][day] = monthData[day] || {};
          // 不需要进行按日归档，文章量没有那么多
          // let dayDir = join(monthDir, day);
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
      return Object.keys(data).
          map((val) => parseInt(val, 10)).
          sort((a, b) => b - a).
          map((val) => {
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
---`;
    }

    function generateYearArchive(year, data) {
      const now = 'Tue, 06 Jun 2017 18:33:59 +0800';
      let tpl = [metaData(`${year}年文章存档`, now)];
      let monthTpl = [metaData(`${year}年文章存档`, now)];

      if (!existsSync(join(distDir, year))) mkdirSync(join(distDir, year));

      // month data desc
      const monthList = descData(data[year]);
      monthList.forEach((month) => {
        tpl.push('', `## [${year}年${month}月](/archives/${year}/${month}/)`, '');

        const dayList = descData(data[year][month]);
        dayList.forEach((day) => {

          const dayData = data[year][month][day];
          const dayDir = join(sourceDir, year, month, day);
          Object.keys(dayData).filter((file) => file.endsWith('.json')).forEach((file) => {

            const content = JSON.parse(readFileSync(join(dayDir, file)).toString());
            let {title, slug} = content;
            tpl.push(`- \`${day}\` [${title}](/${year}/${month}/${day}/${slug}.html)`);
            monthTpl.push(`- \`${day}\` [${title}](/${year}/${month}/${day}/${slug}.html)`);

          });
        });

        if (!existsSync(join(distDir, year, month))) mkdirSync(join(distDir, year, month));
        writeFileSync(join(distDir, year, month, 'index.md'), monthTpl.join('\n'));

      });
      writeFileSync(join(distDir, year, 'index.md'), tpl.join('\n'));
    }

    const ignoreYearList = config.blackList.filter(name => name.match(/20\d{2}/)).map(year => Number(year));
    let yearSkipped = [];
    Object.keys(finalData).forEach((year) => {
      if (ignoreYearList.includes(Number(year))) return yearSkipped.push(year);
      return generateYearArchive(year, finalData);
    });

    console.log(`根据配置忽略以下年份的归档信息：${yearSkipped.join(',')}.`);

  }

  scandir(sourceDir, {
    ignoreHiddenFiles: true,
    ignoreCustomPatterns: /\d{4}\d{2}/,
  }, completionCallback);
};
