#!/usr/bin/env node

'use strict';

const {readFileSync, writeFileSync, existsSync, mkdirSync} = require('fs');
const {basename, join, relative} = require('path');

const config = require('./config.json');
const helper = require('./helper');

/**
 * 生成页面归档文件
 *
 * @param {object} dirsData
 * @param {string} sourceDir
 * @param {string} distDir
 * @return {void}
 */
function generateArchives(dirsData, sourceDir, distDir) {
  let finalData = {};

  // 将文章目录进行数据整理
  const yearList = Object.keys(dirsData).filter((yearDir) => !!yearDir.match(/^\d{4}/));
  yearList.forEach((year) => {
    finalData[year] = finalData[year] || {};
    let yearDir = join(distDir, year);
    if (!existsSync(yearDir)) mkdirSync(yearDir);

    const monthList = Object.keys(dirsData[year]);
    monthList.forEach((month) => {
      finalData[year][month] = finalData[year][month] || {};
      let monthDir = join(yearDir, month);
      if (!existsSync(monthDir)) mkdirSync(monthDir);

      const monthData = dirsData[year][month];
      const dayList = Object.keys(monthData);
      dayList.forEach((day) => {
        finalData[year][month][day] = monthData[day] || {};
        // 暂时不需要进行按日归档，文章量没有那么多
        // let dayDir = join(monthDir, day);
        // if (!existsSync(dayDir)) mkdirSync(dayDir);
      });
    });
  });

  /**
   * 尝试将日期数字用零补全，并进行倒序排列
   * @param {object} data
   * @return {Array}
   */
  function paddingAndDescNumber(data) {
    return Object.keys(data).
        map((val) => parseInt(val, 10)).
        sort((a, b) => b - a).
        map((val) => {
          const paddingData = `0${val}`;
          return paddingData.substring(paddingData.length - 2, paddingData.length);
        });
  }

  /**
   *
   * @param {string} title
   * @param {string} now
   * @return {string}
   */
  function metaFragment(title, now) {
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

  /**
   * 生成该年份的日期归档
   *
   * @param {string} year
   * @param {object} data
   */
  function generateYearArchive(year, data) {
    const now = 'Tue, 06 Jun 2017 18:33:59 +0800';
    let tpl = [metaFragment(`${year}年文章存档`, now)];
    let monthTpl = [metaFragment(`${year}年文章存档`, now)];

    if (!existsSync(join(distDir, year))) mkdirSync(join(distDir, year));

    const monthList = paddingAndDescNumber(data[year]);
    monthList.forEach((month) => {
      tpl.push('', `## [${year}年${month}月](/archives/${year}/${month}/)`, '');

      const dayList = paddingAndDescNumber(data[year][month]);
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

  /**
   * 生成归档首页
   */
  function generateIndexPage() {
    const now = 'Tue, 06 Jun 2017 18:33:59 +0800';
    const tpl = [metaFragment('文章存档', now), '', '# 文章存档'];
    writeFileSync(join(distDir, 'index.md'), tpl.join('\n'));
  }

  const ignoreYearList = config.blackList.filter((name) => name.match(/20\d{2}/)).map((year) => Number(year));
  let yearSkipped = [];

  generateIndexPage();

  Object.keys(finalData).forEach((year) => {
    if (ignoreYearList.includes(Number(year))) return yearSkipped.push(year);
    return generateYearArchive(year, finalData);
  });

  if (yearSkipped.length) {
    console.log(`根据配置忽略以下年份的归档信息：${yearSkipped.join(',')}.`);
  }
}

/**
 * 生成文章归档
 * @param {string} sourceDirPath
 * @param {string} distDirPath
 * @return {void}
 */
module.exports = (sourceDirPath, distDirPath) => {
  const sourceDir = relative('.', sourceDirPath);
  const distDir = distDirPath ? `${distDirPath}/archives` : join('./export', basename(sourceDir), 'archives');
  if (!existsSync(distDir)) mkdirSync(distDir);

  const allPostsFiles = helper.getAllFiles(sourceDir, '.md');
  const dirsData = allPostsFiles.
      map((file) => file.replace(/(.*\/)\d{4}\/\d{2}\/\d{2}/, ($1, $2) => $1.replace($2, ''))).
      reduce((result, item) => {
        let [year, month, day, file] = item.split('/');
        result[year] = result[year] || {};
        result[year][month] = result[year][month] || {};
        result[year][month][day] = result[year][month][day] || {};
        result[year][month][day][file] = true;
        return result;
      }, {});

  return generateArchives(dirsData, sourceDir, distDir);
};
