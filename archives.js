#!/usr/bin/env node

'use strict';

const scandir = require('scandirectory');


const fs = require('fs');
const {readdir, stat, readFile, writeFile, existsSync, mkdirSync} = require('fs');

const path = require('path');
const config = require('./config.json');

// 忽略文件列表、文件编码、调试模式
const {blackList, charset, debug} = config;

const moment = require('moment');

const log = require('./lib/log');
const log4scanDirs = log('scanDirs');

const request = require('request');
const querystring = require('querystring');

// todo enable useCodeHighlight feature
module.exports = function (sourceDirPath, distDirPath) {

    return;
    const sourceDir = path.relative('.', sourceDirPath);
    const distDir = distDirPath ? `${distDirPath}/archives` : path.join('./export', path.basename(sourceDir), 'archives');

    var options = {}

    function completionCallback(err, list, tree) {
        console.log({
            error: err,
            list: list,
            tree: tree
        })
        /*
         {
         error: null,
         list: {
         'a file.txt': 'file',
         'a directory': 'dir',
         'a directory/a sub file.txt': 'file'
         },
         tree: {
         'a file.txt': true,
         'a directory': {
         'a sub file.txt': 'true
         }
         }
         }
         */
    }

    scandir(sourceDir, {
        ignoreHiddenFiles: true,
        ignoreCustomPatterns: /\d{4}\d{2}/
    }, completionCallback)
};
