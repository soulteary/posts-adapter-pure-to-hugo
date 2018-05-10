'use strict';

// 非高频使用，使用*sync api取代async api
const {readdirSync, statSync} = require('fs');
const {join} = require('path');
const {createHmac} = require('crypto');

const config = require('./config.json');

// 忽略文件列表、文件编码、调试模式
const {blackList} = config;

/**
 * 获取目录中所有指定类型的文件
 * @param {string} dirPath
 * @param {string} ext
 * @return {array}
 */
function getAllFiles(dirPath, ext) {
  /**
   * 递归扫描目录
   * @param {string} dirPath
   * @param {string} ext
   * @return {array}
   */
  function scanDir(dirPath, ext) {
    const result = readdirSync(dirPath);
    if (!result.length) return [];
    return result.filter((name) => !(blackList || []).includes(name)).map((dirName) => {
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

  /**
   * 扁平数组
   * @param {array} arr
   * @return {array}
   */
  function flatten(arr) {
    return arr.reduce(function(flat, toFlatten) {
      return flat.concat(Array.isArray(toFlatten) ? flatten(toFlatten) : toFlatten);
    }, []);
  }

  return flatten(scanDir(dirPath, ext)).filter((file) => file);
}

/**
 * 计算文件Hash
 * @param data
 * @return {string}
 */
function md5(data) {
  return createHmac('md5', data).digest('hex');
}

module.exports = {getAllFiles, md5};
